#!/usr/bin/env python3
"""QI(큐아이) 로컬 서버 — 정적 파일 + OpenAI 프록시.

실행:  OPENAI_API_KEY=sk-... python3 qi_server.py        (또는 app/.env 파일에 OPENAI_API_KEY=sk-... 한 줄)
옵션:  OPENAI_MODEL=gpt-4o-mini (기본값) · PORT=8000

브라우저에는 키가 절대 들어가지 않습니다. 앱은 /api/qi 로만 호출하고, 이 서버가 OpenAI 로 전달합니다.
키가 없으면 /api/qi/health 가 ok:false 를 돌려주고, 앱은 기존 규칙 기반 답변으로 자동 전환됩니다.
"""
import hmac, json, os, sys, time, threading, urllib.request, urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    p = os.path.join(ROOT, '.env')
    if os.path.exists(p):
        for line in open(p, encoding='utf8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
KEY = os.environ.get('OPENAI_API_KEY', '')
MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
PORT = int(os.environ.get('PORT', '8000'))
HOST = os.environ.get('HOST', '127.0.0.1')              # 기본: 내 컴퓨터에서만 접속 가능 (같은 와이파이의 다른 사람은 못 씀)
CODE = os.environ.get('QI_ACCESS_CODE', '').strip()             # 설정하면 이 코드를 아는 사람만 AI 사용 (온라인 배포 시 필수)
TRUST_PROXY = os.environ.get('QI_TRUST_PROXY') == '1'   # Render 같은 호스팅 뒤에서는 1 (실제 접속자 주소를 X-Forwarded-For 에서 읽음)
RATE = int(os.environ.get('QI_RATE_PER_MIN', '20'))     # 한 주소당 1분에 최대 요청 수
DAILY = int(os.environ.get('QI_DAILY_CAP', '300'))      # 하루 전체 최대 요청 수 (넘으면 AI 답변만 멈춤)
_lock, _hits, _day = threading.Lock(), {}, {'d': time.strftime('%Y-%m-%d'), 'n': 0}


def allowed(ip):
    with _lock:
        today = time.strftime('%Y-%m-%d')
        if _day['d'] != today:
            _day.update(d=today, n=0)
        if _day['n'] >= DAILY:
            return 'daily cap reached'
        now = time.time()
        q = [t for t in _hits.get(ip, []) if now - t < 60]
        if len(q) >= RATE:
            _hits[ip] = q
            return 'too many requests'
        q.append(now); _hits[ip] = q; _day['n'] += 1
    return None
LANGS = {'en': 'English', 'ko': 'Korean (한국어, 해요체)', 'ja': 'Japanese (日本語, です・ます調)', 'zh': 'Simplified Chinese (简体中文)'}

SYSTEM = """You are QI (큐아이), an active museum docent agent for foreign visitors at the National Museum of Korea (Prehistory & Ancient History gallery: Goguryeo, Baekje, Gaya, Silla).
You speak to the visitor who is walking through the gallery right now, through a chat on their phone.

How to answer:
- Answer the visitor's actual question directly in the first sentence. Do not greet again, do not repeat what the card already says.
- 2 to 4 short sentences, plain words, no markdown, no lists, no emoji. Easy for a non-native listener to follow when read aloud.
- Use the FACTS block for anything specific to the object (names, places, inscriptions, materials, dates). Never invent inscriptions, dates, measurements, excavation sites or museum numbers.
- If the question goes beyond the FACTS, you may add well-established general history of that kingdom, but say so lightly ("In general, ...") and say plainly when you are not sure. If you truly do not know, say that and offer what you do know.
- If the visitor asks about another object in the gallery, answer from general knowledge with the same caution.
- You may end with ONE short follow-up suggestion (a related thing to look at or ask) when it is natural. Never more than one question.
- Reply in the language requested by LANGUAGE, whatever language the visitor writes in, unless they explicitly ask for another language.
- Stay on museum, history, art and visiting topics. Politely steer back otherwise."""


def build_messages(body):
    lang = LANGS.get(body.get('lang', 'en'), 'English')
    facts = str(body.get('facts', ''))[:5000]
    cur = str(body.get('current', ''))[:80]
    sys_msg = SYSTEM + f"\n\nLANGUAGE: {lang}\nCURRENT OBJECT ID (what the visitor is looking at): {cur or 'none yet'}\n\nFACTS:\n{facts or '(no object selected)'}"
    msgs = [{'role': 'system', 'content': sys_msg}]
    for h in (body.get('history') or [])[-8:]:
        if h.get('role') in ('user', 'assistant') and isinstance(h.get('content'), str):
            msgs.append({'role': h['role'], 'content': h['content'][:600]})
    msgs.append({'role': 'user', 'content': str(body.get('text', ''))[:600]})
    return msgs


def call_openai(msgs):
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=json.dumps({'model': MODEL, 'messages': msgs, 'temperature': 0.5, 'max_tokens': 320}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        j = json.loads(r.read())
    return j['choices'][0]['message']['content'].strip()


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')   # always fetch the newest files while developing
        super().end_headers()

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith('/api/qi/health'):
            return self._json(200, {'ok': bool(KEY), 'model': MODEL, 'needCode': bool(CODE)})
        p = self.path.split('?', 1)[0]
        if any(seg.startswith('.') for seg in p.split('/') if seg) or p.endswith(('.py', '.yaml', '.yml', '.example')):
            return self._json(404, {'error': 'not found'})                 # .env, .git, 서버 코드는 절대 내려주지 않음
        return super().do_GET()

    def _read_body(self):
        """요청 본문을 항상 끝까지 읽는다 (Content-Length 또는 chunked). 너무 크면 None."""
        if 'chunked' in self.headers.get('Transfer-Encoding', '').lower():
            out = b''
            while True:
                line = self.rfile.readline(64).strip()
                size = int(line.split(b';')[0] or b'0', 16)
                if size == 0:
                    while self.rfile.readline(64).strip():
                        pass
                    return out
                if len(out) + size > 20000:
                    self.close_connection = True
                    return None
                out += self.rfile.read(size)
                self.rfile.readline(4)
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            n = 0
        if n > 20000:
            self.close_connection = True
            return None
        return self.rfile.read(n) if n > 0 else b''

    def do_POST(self):
        if not self.path.startswith('/api/qi'):
            return self._json(404, {'error': 'not found'})
        raw = self._read_body()
        if raw is None:
            return self._json(413, {'error': 'too large'})
        if not KEY:
            return self._json(503, {'error': 'OPENAI_API_KEY not set'})
        origin = self.headers.get('Origin')
        if origin and origin.split('://', 1)[-1] != self.headers.get('Host'):   # 다른 사이트에서 몰래 부르는 요청 차단
            return self._json(403, {'error': 'forbidden origin'})
        if CODE and not hmac.compare_digest(self.headers.get('X-QI-Code', '').encode('utf8', 'ignore'), CODE.encode('utf8')):
            return self._json(401, {'error': 'access code required'})
        ip = self.client_address[0]
        if TRUST_PROXY and self.headers.get('X-Forwarded-For'):
            ip = self.headers['X-Forwarded-For'].split(',')[0].strip()
        why = allowed(ip)
        if why:
            return self._json(429, {'error': why})
        try:
            body = json.loads(raw or b'{}')
            return self._json(200, {'reply': call_openai(build_messages(body))})
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf8', 'ignore')[:300]
            print('OpenAI error', e.code, detail, file=sys.stderr)
            return self._json(502, {'error': f'openai {e.code}'})
        except Exception as e:
            print('proxy error', repr(e), file=sys.stderr)
            return self._json(502, {'error': 'proxy error'})

    def log_message(self, fmt, *a):
        if '/api/' in (a[0] if a else ''):
            sys.stderr.write('[api] ' + (fmt % a) + '\n')


if __name__ == '__main__':
    print(f'QI server  http://localhost:{PORT}/   model={MODEL}   OpenAI key: {"set" if KEY else "NOT set (rule-based answers only)"}   listening on {HOST}   access code: {"on" if CODE else "OFF"}   limits: {RATE}/min, {DAILY}/day')
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
