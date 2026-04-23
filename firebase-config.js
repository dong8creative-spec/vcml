/**
 * Firebase 콘솔에서 프로젝트를 만든 뒤 웹 앱 설정 값을 아래에 넣으세요.
 * https://console.firebase.google.com/ → 프로젝트 설정 → 일반 → 내 앱
 *
 * Authentication: Google 로그인 사용 설정
 * Firestore: 데이터베이스 생성 후 아래 규칙 예시 배포
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     match /vcml_moodboard/{docId} {
 *       allow read: if true;
 *       allow create: if request.auth != null
 *         && request.resource.data.userId == request.auth.uid;
 *       allow delete: if request.auth != null && resource.data.userId == request.auth.uid;
 *       allow update: if false;
 *     }
 *   }
 * }
 */
window.VCML_FIREBASE = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:xxxxxxxx"
};
