# 로컬 HTTPS 설정 (Windows, mkcert) — IMA/Ad Manager 테스트용

Google IMA와 유사한 광고 SDK는 ‘신뢰 가능한 오리진’(trustworthy origin, HTTPS 또는 localhost)을 요구합니다.
개발 환경에서 HTTPS로 로컬을 띄우는 방법 2가지를 안내합니다: mkcert로 로컬 인증서 만들기(권장) 또는 ngrok으로 HTTPS URL 제공(간단).

---

## A. mkcert로 로컬 HTTPS (권장)
윈도우에서 PowerShell을 이용한 방법입니다.

1) mkcert 설치
 - macOS / Linux 는 Homebrew 또는 패키지 사용. Windows는 Chocolatey나 직접 설치.
 - Chocolatey 사용 예:

```powershell
choco install mkcert
mkcert -install
```

혹은 링크에서 설치: https://github.com/FiloSottile/mkcert

2) 프로젝트 루트에서 인증서 생성
```powershell
# 작업 디렉토리를 프로젝트 루트(c:\Users\LG\Desktop\refn)로 이동
cd C:\Users\LG\Desktop\refn

# 로컬용 인증서 생성 (localhost 용)
mkcert -cert-file ./certs/localhost.pem -key-file ./certs/localhost-key.pem localhost
```
생성된 파일은 `./certs/localhost.pem` 와 `./certs/localhost-key.pem` 입니다.

3) 서버 실행 (환경변수 사용 권장)
- Windows PowerShell 예:

```powershell
$env:CERT_PEM_PATH = "C:\Users\LG\Desktop\refn\certs\localhost.pem"
$env:CERT_KEY_PATH = "C:\Users\LG\Desktop\refn\certs\localhost-key.pem"
node server.js
```

서버가 HTTPS로 시작되면 콘솔에:
> HTTPS server running on https://localhost:PORT

4) 브라우저에서 접근
- https://localhost:PORT 로 접근하세요.
- 브라우저가 로컬 mkcert CA를 신뢰하므로 SSL 경고가 뜨지 않아야 합니다.

---

## B. ngrok으로 빠른 HTTPS URL 만들기 (간단 테스트용)
1) ngrok 설치 및 로그인
- https://ngrok.com 에 가입하고 CLI 설치
- `ngrok authtoken <your-token>` 로 인증

2) 로컬 서버 공개
```powershell
# 예: 로컬 포트 3000을 HTTPS로 노출
ngrok http 3000
```

3) ngrok에서 제공하는 HTTPS 주소(ex: https://random-subdomain.ngrok.io)로 IMA 테스트를 진행하세요.
- 단점: ngrok URL은 공개 도메인이므로 광고 플랫폼의 도메인 정책/보안 설정을 확인하세요.

---

## 디버깅 팁
- `Cross-Origin-Opener-Policy header has been ignored` 경고가 보이면 HTTPS/localhost로 접근하고 있는지 먼저 확인하세요.
- IMA SDK 콘솔 에러가 뜰 경우 광고 태그(adTagUrl)나 브라우저 확장(AdBlock) 차단 여부를 확인하세요.
- IMA 테스트 adTag가 정상 동작하지 않을 경우 GAM의 테스트 ad unit(Rewarded) 또는 네트워크 테스트 태그를 사용하세요.

---

원하시면 제가 `server.js`를 직접 HTTPS로 자동 실행하도록 수정(이미 적용해둠)해 드렸습니다. mkcert를 사용해 certs를 생성하고 실행하면 바로 HTTPS로 동작합니다.