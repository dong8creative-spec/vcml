(function () {
    'use strict';

    var COL = 'vcml_moodboard';
    var allDocs = [];
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
                        embedUrl: 'https://www.instagram.com/reel/' + code + '/embed/',
                        canonical: 'https://www.instagram.com/reel/' + code + '/'
                    };
                }
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function formatDate(ts) {
        if (!ts || !ts.toDate) return '';
        var d = ts.toDate();
        return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    }

    function embedSizeClass(id) {
        var n = 0;
        for (var i = 0; i < id.length; i++) n += id.charCodeAt(i);
        return ['mb-embed--1', 'mb-embed--2', 'mb-embed--3'][n % 3];
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
            if (el('mbForm')) el('mbForm').hidden = true;
            var g0 = el('mbGrid');
            if (g0) g0.innerHTML = '<p class="mb-empty">여러분들이 좋아하는 숏폼을 올려주세요.</p>';
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
        if (user) {
            if (signIn) signIn.hidden = true;
            if (signOut) signOut.hidden = false;
            if (userLabel) {
                userLabel.hidden = false;
                userLabel.textContent = user.displayName || user.email || '';
            }
            if (form) form.hidden = false;
        } else {
            if (signIn) signIn.hidden = false;
            if (signOut) signOut.hidden = true;
            if (userLabel) userLabel.hidden = true;
            if (form) form.hidden = true;
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
        embed.className = 'mb-embed ' + embedSizeClass(doc.id);
        var iframe = document.createElement('iframe');
        iframe.src = d.embedUrl;
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('title', d.kind === 'reel' ? 'Instagram Reel' : 'YouTube Shorts');
        iframe.setAttribute('allow', 'encrypted-media; fullscreen; picture-in-picture');
        embed.appendChild(iframe);

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
        embed.appendChild(ov);

        var badge = document.createElement('div');
        badge.className = 'mb-vid-badge';
        badge.textContent = d.kind === 'reel' ? 'Reels' : '쇼츠';
        embed.appendChild(badge);

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
        if (uid && d.userId === uid) {
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'mb-del';
            del.textContent = '삭제';
            del.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!confirm('이 핀을 삭제할까요?')) return;
                db.collection(COL)
                    .doc(doc.id)
                    .delete()
                    .catch(function (e2) {
                        alert(e2.message || '삭제에 실패했습니다.');
                    });
            });
            card.appendChild(del);
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
        if (unsub) unsub();
        unsub = db
            .collection(COL)
            .orderBy('createdAt', 'desc')
            .onSnapshot(
                function (snap) {
                    allDocs = snap.docs.slice();
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
        if (!auth || !auth.currentUser) {
            alert('Google 로그인 후 핀을 추가할 수 있습니다.');
            return;
        }
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
        if (!auth || !auth.currentUser || !db) return;
        var input = el('mbUrl');
        var noteEl = el('mbNote');
        var urlRaw = (input && input.value) || '';
        var parsed = parseMoodboardUrl(urlRaw);
        if (!parsed) {
            alert('인스타그램 릴스(…/reel/…) 또는 유튜브 쇼츠(…/shorts/…) URL만 등록할 수 있습니다.');
            return;
        }
        var note = noteEl && noteEl.value ? noteEl.value.trim().slice(0, 200) : '';
        var tagArr = collectTagsFromForm();
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
    }

    function boot() {
        bindAuth();
        bindModal();
        bindPills();
        bindSearch();
        initFirebase();
        listen();
        var form = el('mbForm');
        if (form) form.addEventListener('submit', onSubmit);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
