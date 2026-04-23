(function () {
    'use strict';

    var COL = 'vcml_moodboard';
    var LOCAL_KEY = 'vcml_moodboard_local_pins';
    var allDocs = [];
    var localPins = [];
    var lastRemoteDocs = [];
    var currentFilter = 'all';
    var searchQ = '';
    var searchT = null;

    function el(id) {
        return document.getElementById(id);
    }

    function isFirebaseConfigured() {
        var c = window.VCML_FIREBASE;
        if (!c || !c.apiKey) return false;
        if (c.apiKey === 'YOUR_API_KEY' || c.apiKey.indexOf('YOUR_') === 0) return false;
        return true;
    }

    function parseMoodboardUrl(raw) {
        var u = (raw || '').trim();
        if (!u) return null;
        try {
            var url = new URL(u);
            var h = (url.hostname || '').replace(/^www\./, '');
            if (h === 'youtube.com' || h === 'm.youtube.com') {
                var ym = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})\/?/);
                if (ym) {
                    var vid = ym[1];
                    return {
                        kind: 'shorts',
                        embedUrl: 'https://www.youtube.com/embed/' + vid,
                        canonical: 'https://www.youtube.com/shorts/' + vid
                    };
                }
            }
            if (h === 'instagram.com') {
                var im = url.pathname.match(/^\/reel\/([^/?#]+)/);
                if (im) {
                    var code = im[1];
                    return {
                        kind: 'reel',
                        embedUrl: buildInstagramEmbedSrc('https://www.instagram.com/reel/' + code + '/embed/'),
                        canonical: 'https://www.instagram.com/reel/' + code + '/'
                    };
                }
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function shouldAutoplayByConnection() {
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return true;
        if (c.saveData) return false;
        if (c.type === 'cellular') return false;
        if (c.type === 'wifi' || c.type === 'ethernet') return true;
        if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g') return false;
        return true;
    }

    function buildYoutubeEmbedSrc(embedUrl, shouldAutoplay) {
        var m = (embedUrl || '').match(/\/embed\/([a-zA-Z0-9_-]{11})/);
        if (!m) return embedUrl;
        var vid = m[1];
        var originParam = '';
        try {
            var o = window.location.origin;
            if (o && o.indexOf('http') === 0) {
                originParam = '&origin=' + encodeURIComponent(o);
            }
        } catch (e) {}
        var ap = shouldAutoplay ? 1 : 0;
        return (
            'https://www.youtube.com/embed/' +
            vid +
            '?autoplay=' +
            ap +
            '&mute=1&playsinline=1&controls=1&rel=0&enablejsapi=1' +
            originParam
        );
    }

    function buildInstagramEmbedSrc(embedUrl) {
        var u = (embedUrl || '').trim().split('#')[0];
        var m = u.match(/instagram\.com\/reel\/([^/?#]+)/i);
        var code = m ? m[1] : null;
        var base = code ? 'https://www.instagram.com/reel/' + code + '/embed/' : u.replace(/\/?$/, '/');
        if (base.indexOf('/embed') < 0 && code) {
            base = 'https://www.instagram.com/reel/' + code + '/embed/';
        }
        base = base.replace(/\/embed\/captioned\/?/i, '/embed/');
        if (base.indexOf('captioned=false') >= 0) return base;
        if (base.indexOf('?') >= 0) return base + '&captioned=false';
        return base + '?captioned=false';
    }

    function ytPlayerCommand(iframe, funcName) {
        if (!iframe || !iframe.contentWindow) return;
        try {
            iframe.contentWindow.postMessage(
                JSON.stringify({ event: 'command', func: funcName, args: [] }),
                'https://www.youtube.com'
            );
        } catch (e) {}
    }

    function bindYoutubeMuteHover(container, iframe) {
        if (!container || !iframe) return;
        var onEnter = function () {
            ytPlayerCommand(iframe, 'unMute');
        };
        var onLeave = function () {
            ytPlayerCommand(iframe, 'mute');
        };
        container.addEventListener('mouseenter', onEnter);
        container.addEventListener('mouseleave', onLeave);
    }

    function formatDate(ts) {
        if (!ts) return '';
        var d = null;
        if (ts.toDate) d = ts.toDate();
        else {
            var t = new Date(ts);
            if (!isNaN(t.getTime())) d = t;
        }
        if (!d) return '';
        return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }

    function docTime(doc) {
        var d = doc.data();
        var c = d.createdAt;
        if (c && c.toDate) return c.toDate().getTime();
        if (typeof c === 'string' || typeof c === 'number') {
            var t = new Date(c);
            if (!isNaN(t.getTime())) return t.getTime();
        }
        return 0;
    }

    function loadLocalPins() {
        try {
            var raw = localStorage.getItem(LOCAL_KEY);
            localPins = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(localPins)) localPins = [];
        } catch (e) {
            localPins = [];
        }
    }

    function saveLocalPins() {
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(localPins));
        } catch (e) {}
    }

    function pinToFakeDoc(p) {
        return {
            id: p.id,
            data: function () {
                return p;
            }
        };
    }

    function mergeWithLocal(remoteDocs) {
        var locals = localPins.map(pinToFakeDoc);
        var all = remoteDocs.slice().concat(locals);
        all.sort(function (a, b) {
            return docTime(b) - docTime(a);
        });
        return all;
    }

    function removeLocalPinById(id) {
        localPins = localPins.filter(function (p) {
            return p.id !== id;
        });
        saveLocalPins();
        allDocs = mergeWithLocal(lastRemoteDocs);
        applyFilter();
    }

    function addLocalPin(parsed, note, tagArr) {
        var id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        var p = {
            id: id,
            kind: parsed.kind,
            url: parsed.canonical,
            embedUrl: parsed.embedUrl,
            note: note,
            tags: tagArr,
            userId: 'local-guest',
            userName: '비로그인',
            createdAt: new Date().toISOString()
        };
        localPins.unshift(p);
        saveLocalPins();
    }

    function isCanonicalUrlRegistered(canonical) {
        var i;
        for (i = 0; i < localPins.length; i++) {
            if (localPins[i].url === canonical) return true;
        }
        for (i = 0; i < lastRemoteDocs.length; i++) {
            var d = lastRemoteDocs[i].data();
            if (d.url === canonical) return true;
        }
        return false;
    }

    function getTags(d) {
        if (d.tags && Array.isArray(d.tags)) return d.tags;
        return [];
    }

    function matchesFilter(d, f) {
        if (f === 'all') return true;
        if (f === 'reel') return d.kind === 'reel';
        if (f === 'shorts') return d.kind === 'shorts';
        var tags = getTags(d);
        return tags.indexOf(f) >= 0;
    }

    function collectTagsFromForm() {
        var tags = [];
        var boxes = document.querySelectorAll('input[name="mbPreset"]:checked');
        for (var i = 0; i < boxes.length; i++) tags.push(boxes[i].value);
        var raw = (el('mbCustomTags') && el('mbCustomTags').value) || '';
        var parts = raw.split(/[,，、]/);
        var nCustom = 0;
        for (var j = 0; j < parts.length; j++) {
            if (nCustom >= 10) break;
            var t = parts[j].trim();
            if (!t) continue;
            if (t.length > 32) t = t.slice(0, 32);
            tags.push(t);
            nCustom++;
        }
        var out = [];
        var seen = {};
        for (var k = 0; k < tags.length && out.length < 20; k++) {
            if (seen[tags[k]]) continue;
            seen[tags[k]] = true;
            out.push(tags[k]);
        }
        return out;
    }

    function resetAddForm() {
        var u = el('mbUrl');
        if (u) u.value = '';
        var n = el('mbNote');
        if (n) n.value = '';
        var c = el('mbCustomTags');
        if (c) c.value = '';
        var boxes = document.querySelectorAll('input[name="mbPreset"]');
        for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    }

    var app, auth, db;
    var unsub = null;

    function initFirebase() {
        if (!isFirebaseConfigured()) {
            if (el('mbConfigWarn')) el('mbConfigWarn').hidden = false;
            if (el('mbForm')) el('mbForm').hidden = false;
            lastRemoteDocs = [];
            allDocs = mergeWithLocal([]);
            applyFilter();
            return;
        }
        if (firebase.apps && firebase.apps.length) {
            app = firebase.app();
        } else {
            app = firebase.initializeApp(window.VCML_FIREBASE);
        }
        auth = firebase.auth();
        db = firebase.firestore();
        auth.onAuthStateChanged(onUser);
    }

    function onUser(user) {
        var signIn = el('mbSignIn');
        var signOut = el('mbSignOut');
        var userLabel = el('mbUserLabel');
        var form = el('mbForm');
        if (form) form.hidden = false;
        if (user) {
            if (signIn) signIn.hidden = true;
            if (signOut) signOut.hidden = false;
            if (userLabel) {
                userLabel.hidden = false;
                userLabel.textContent = user.displayName || user.email || '';
            }
        } else {
            if (signIn) signIn.hidden = false;
            if (signOut) signOut.hidden = true;
            if (userLabel) userLabel.hidden = true;
        }
    }

    function bindAuth() {
        var signIn = el('mbSignIn');
        var signOut = el('mbSignOut');
        if (signIn) {
            signIn.addEventListener('click', function () {
                if (!auth) {
                    alert('firebase-config.js에 Firebase 웹 앱 설정을 넣은 뒤 다시 시도해 주세요.');
                    return;
                }
                var p = new firebase.auth.GoogleAuthProvider();
                p.setCustomParameters({ prompt: 'select_account' });
                auth.signInWithPopup(p).catch(function (e) {
                    alert(e.message || '로그인에 실패했습니다.');
                });
            });
        }
        if (signOut) {
            signOut.addEventListener('click', function () {
                if (auth) auth.signOut();
            });
        }
    }

    function reelShortCodeFromUrl(canonical) {
        var m = (canonical || '').match(/instagram\.com\/reel\/([^/?#]+)/i);
        return m ? m[1] : null;
    }

    function applyReelPosterThumb(img, link, canonicalUrl) {
        var markFail = function () {
            img.classList.add('mb-reel-poster-fallback');
            img.removeAttribute('src');
            if (link) link.classList.add('mb-reel-poster-link--empty');
        };
        var code = reelShortCodeFromUrl(canonicalUrl);
        var tryMedia = function () {
            if (!code) {
                markFail();
                return;
            }
            img.addEventListener(
                'error',
                function () {
                    markFail();
                },
                { once: true }
            );
            img.src = 'https://www.instagram.com/p/' + code + '/media/?size=l';
        };
        /* 로컬 serve_main_site.py 가 같은 출처에서 /api/ig-thumb 로 oEmbed를 대신 호출 (브라우저 CORS 회피) */
        fetch('/api/ig-thumb?url=' + encodeURIComponent(canonicalUrl))
            .then(function (r) {
                if (!r.ok) return Promise.reject();
                return r.json();
            })
            .then(function (j) {
                if (j && j.thumbnail_url) {
                    img.addEventListener(
                        'error',
                        function () {
                            tryMedia();
                        },
                        { once: true }
                    );
                    img.src = j.thumbnail_url;
                    return;
                }
                tryMedia();
            })
            .catch(function () {
                tryMedia();
            });
    }

    function copyUrl(url) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(
                function () { alert('링크를 복사했습니다.'); },
                function () { window.prompt('복사해 주세요:', url); }
            );
        } else {
            window.prompt('복사해 주세요:', url);
        }
    }

    function renderCard(doc) {
        var d = doc.data();
        var card = document.createElement('article');
        card.className = 'mb-card';
        card.dataset.id = doc.id;
        card.dataset.kind = d.kind;

        var inner = document.createElement('div');
        inner.className = 'mb-card-inner';

        var embed = document.createElement('div');
        embed.className = d.kind === 'reel' ? 'mb-embed mb-embed--reel' : 'mb-embed';

        var autoplayOk = shouldAutoplayByConnection();
        var iframe = null;

        var ov = document.createElement('div');
        ov.className = 'mb-pin-overlay';
        var top = document.createElement('div');
        top.className = 'mb-pin-ov-t';
        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'mb-save';
        save.textContent = '저장';
        save.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            copyUrl(d.url);
        });
        top.appendChild(save);
        var bottom = document.createElement('div');
        bottom.className = 'mb-pin-ov-b';
        var ext = document.createElement('a');
        ext.className = 'mb-ext';
        ext.href = d.url;
        ext.target = '_blank';
        ext.rel = 'noopener noreferrer';
        ext.setAttribute('aria-label', '새 창에서 열기');
        ext.textContent = '↗';
        ext.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        bottom.appendChild(ext);
        ov.appendChild(top);
        ov.appendChild(bottom);
        if (d.kind === 'shorts') {
            iframe = document.createElement('iframe');
            iframe.setAttribute('allowfullscreen', '');
            iframe.setAttribute('title', 'YouTube Shorts');
            iframe.src = buildYoutubeEmbedSrc(d.embedUrl, autoplayOk);
            iframe.setAttribute('loading', 'lazy');
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            embed.appendChild(iframe);
        } else if (d.kind === 'reel') {
            var posterLink = document.createElement('a');
            posterLink.className = 'mb-reel-poster-link';
            posterLink.href = d.url;
            posterLink.target = '_blank';
            posterLink.rel = 'noopener noreferrer';
            posterLink.setAttribute('aria-label', 'Instagram에서 릴스 열기');
            var posterImg = document.createElement('img');
            posterImg.className = 'mb-reel-poster-img';
            posterImg.alt = '';
            posterImg.setAttribute('loading', 'lazy');
            var posterPlay = document.createElement('span');
            posterPlay.className = 'mb-reel-poster-play';
            posterPlay.setAttribute('aria-hidden', 'true');
            posterPlay.textContent = '▶';
            posterLink.appendChild(posterImg);
            posterLink.appendChild(posterPlay);
            embed.appendChild(posterLink);
            applyReelPosterThumb(posterImg, posterLink, d.url);
        }

        embed.appendChild(ov);

        if (d.kind !== 'reel') {
            var badge = document.createElement('div');
            badge.className = 'mb-vid-badge';
            badge.textContent = '쇼츠';
            embed.appendChild(badge);
        }

        var title = document.createElement('div');
        title.className = 'mb-title-line';
        title.textContent = d.note || '';

        var tagList = getTags(d);

        var sub = document.createElement('div');
        sub.className = 'mb-sub-line';
        sub.textContent = (d.userName || '익명') + ' · ' + formatDate(d.createdAt);

        inner.appendChild(embed);
        inner.appendChild(title);
        if (tagList.length) {
            var trow = document.createElement('div');
            trow.className = 'mb-card-tags';
            for (var ti = 0; ti < tagList.length; ti++) {
                var ch = document.createElement('span');
                ch.className = 'mb-tag-chip';
                ch.textContent = tagList[ti];
                trow.appendChild(ch);
            }
            inner.appendChild(trow);
        }
        inner.appendChild(sub);
        card.appendChild(inner);

        var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
        var canDel = (uid && d.userId === uid) || d.userId === 'local-guest';
        if (canDel) {
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'mb-del';
            del.textContent = '삭제';
            del.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!confirm('이 핀을 삭제할까요?')) return;
                if (d.userId === 'local-guest') {
                    removeLocalPinById(doc.id);
                    return;
                }
                if (!db) return;
                db.collection(COL)
                    .doc(doc.id)
                    .delete()
                    .catch(function (e2) {
                        alert(e2.message || '삭제에 실패했습니다.');
                    });
            });
            card.appendChild(del);
        }

        if (d.kind === 'shorts' && iframe) {
            bindYoutubeMuteHover(inner, iframe);
        }

        return card;
    }

    function applyFilter() {
        var g = el('mbGrid');
        if (!g) return;
        g.innerHTML = '';
        if (!allDocs.length) {
            g.innerHTML = '<p class="mb-empty" id="mbEmpty">아직 숏폼이 안보이네요. + 버튼으로 추가해 보세요.</p>';
            return;
        }
        var q = (searchQ || '').toLowerCase().trim();
        var n = 0;
        for (var i = 0; i < allDocs.length; i++) {
            var doc = allDocs[i];
            var d = doc.data();
            if (!matchesFilter(d, currentFilter)) continue;
            if (q) {
                var hay = (d.note || '') + ' ' + (d.url || '') + ' ' + (d.userName || '') + ' ' + getTags(d).join(' ');
                if (hay.toLowerCase().indexOf(q) < 0) continue;
            }
            g.appendChild(renderCard(doc));
            n++;
        }
        if (!n) {
            g.innerHTML = '<p class="mb-empty">조건에 맞는 핀이 없습니다.</p>';
        }
    }

    function listen() {
        if (!db) return;
        allDocs = mergeWithLocal(lastRemoteDocs);
        applyFilter();
        if (unsub) unsub();
        unsub = db
            .collection(COL)
            .orderBy('createdAt', 'desc')
            .onSnapshot(
                function (snap) {
                    lastRemoteDocs = snap.docs.slice();
                    allDocs = mergeWithLocal(lastRemoteDocs);
                    applyFilter();
                },
                function (err) {
                    var g = el('mbGrid');
                    if (g) g.innerHTML = '<p class="mb-err">불러오기 오류: ' + (err && err.message ? err.message : String(err)) + '</p>';
                }
            );
    }

    function openModal() {
        var m = el('mbAddModal');
        if (!m) return;
        resetAddForm();
        m.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        var m = el('mbAddModal');
        if (!m) return;
        m.hidden = true;
        document.body.style.overflow = '';
    }

    function bindModal() {
        var fab = el('mbFab');
        if (fab) {
            fab.addEventListener('click', openModal);
        }
        var modal = el('mbAddModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target.getAttribute('data-close') === '1') closeModal();
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && el('mbAddModal') && !el('mbAddModal').hidden) closeModal();
        });
    }

    function bindPills() {
        var wrap = el('mbPills');
        if (!wrap) return;
        wrap.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.getAttribute) return;
            var f = t.getAttribute('data-filter');
            if (!f) return;
            currentFilter = f;
            var pills = wrap.querySelectorAll('.mb-pill');
            for (var i = 0; i < pills.length; i++) {
                var p = pills[i];
                var on = p.getAttribute('data-filter') === f;
                p.classList.toggle('is-active', on);
                p.setAttribute('aria-selected', on ? 'true' : 'false');
            }
            applyFilter();
        });
    }

    function bindSearch() {
        var s = el('mbSearch');
        if (!s) return;
        s.addEventListener('input', function () {
            if (searchT) clearTimeout(searchT);
            var v = s.value;
            searchT = setTimeout(function () {
                searchQ = v;
                applyFilter();
            }, 200);
        });
    }

    function onSubmit(e) {
        e.preventDefault();
        var input = el('mbUrl');
        var noteEl = el('mbNote');
        var urlRaw = (input && input.value) || '';
        var parsed = parseMoodboardUrl(urlRaw);
        if (!parsed) {
            alert('인스타그램 릴스(…/reel/…) 또는 유튜브 쇼츠(…/shorts/…) URL만 등록할 수 있습니다.');
            return;
        }
        if (isCanonicalUrlRegistered(parsed.canonical)) {
            alert('이미 등록된 숏폼입니다.');
            return;
        }
        var note = noteEl && noteEl.value ? noteEl.value.trim().slice(0, 200) : '';
        var tagArr = collectTagsFromForm();

        if (auth && auth.currentUser && db) {
            var u = auth.currentUser;
            var payload = {
                kind: parsed.kind,
                url: parsed.canonical,
                embedUrl: parsed.embedUrl,
                note: note,
                tags: tagArr,
                userId: u.uid,
                userName: u.displayName || u.email || '',
                userPhoto: u.photoURL || '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (el('mbSubmit')) el('mbSubmit').disabled = true;
            db.collection(COL)
                .add(payload)
                .then(function () {
                    resetAddForm();
                    closeModal();
                })
                .catch(function (err) {
                    alert(err.message || '저장에 실패했습니다.');
                })
                .then(function () {
                    if (el('mbSubmit')) el('mbSubmit').disabled = false;
                });
            return;
        }

        addLocalPin(parsed, note, tagArr);
        allDocs = mergeWithLocal(lastRemoteDocs);
        applyFilter();
        resetAddForm();
        closeModal();
    }

    function boot() {
        loadLocalPins();
        bindAuth();
        bindModal();
        bindPills();
        bindSearch();
        initFirebase();
        listen();
        var form = el('mbForm');
        if (form) {
            form.hidden = false;
            form.addEventListener('submit', onSubmit);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
