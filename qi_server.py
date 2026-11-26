#!/usr/bin/env python3
"""QI(큐아이) 로컬 서버 — 정적 파일 + OpenAI 프록시.

실행:  OPENAI_API_KEY=sk-... python3 qi_server.py        (또는 app/.env 파일에 OPENAI_API_KEY=sk-... 한 줄)
옵션:  OPENAI_MODEL=gpt-4o-mini (기본값) · PORT=8000

브라우저에는 키가 절대 들어가지 않습니다. 앱은 /api/qi 로만 호출하고, 이 서버가 OpenAI 로 전달합니다.
키가 없으면 /api/qi/health 가 ok:false 를 돌려주고, 앱은 기존 규칙 기반 답변으로 자동 전환됩니다.
"""
import hashlib, hmac, json, os, sys, time, threading, urllib.request, urllib.error, urllib.parse
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
# ElevenLabs 음성 (모든 나라가 같은 목소리). 키는 .env 의 ELEVENLABS_API_KEY — 브라우저로는 절대 나가지 않음
ELEVEN_KEY = os.environ.get('ELEVENLABS_API_KEY', '')
ELEVEN_VOICE = os.environ.get('ELEVENLABS_VOICE_ID', 's3TPKV1kjDlVtZbl4Ksh')
ELEVEN_MODEL = os.environ.get('ELEVENLABS_MODEL', 'eleven_multilingual_v2')
ELEVEN_BASE = os.environ.get('ELEVENLABS_BASE', 'https://api.elevenlabs.io')
TTS_RATE = int(os.environ.get('QI_TTS_RATE_PER_MIN', '40'))
TTS_DAILY = int(os.environ.get('QI_TTS_DAILY_CAP', '800'))
_tts_cache = {}                                          # 같은 문장은 다시 만들지 않음 (비용 절약)
_lock, _hits, _day = threading.Lock(), {}, {'d': time.strftime('%Y-%m-%d'), 'n': 0}
_thits, _tday = {}, {'d': time.strftime('%Y-%m-%d'), 'n': 0}


def allowed(ip, hits=None, day=None, rate=None, cap=None):
    hits = _hits if hits is None else hits; day = _day if day is None else day; rate = RATE if rate is None else rate; cap = DAILY if cap is None else cap
    with _lock:
        today = time.strftime('%Y-%m-%d')
        if day['d'] != today:
            day.update(d=today, n=0)
        if day['n'] >= cap:
            return 'daily cap reached'
        now = time.time()
        q = [t for t in hits.get(ip, []) if now - t < 60]
        if len(q) >= rate:
            hits[ip] = q
            return 'too many requests'
        q.append(now); hits[ip] = q; day['n'] += 1
    return None


def call_eleven(text):
    key = hashlib.sha256((ELEVEN_VOICE + '|' + text).encode('utf8')).hexdigest()
    if key in _tts_cache:
        return _tts_cache[key]
    req = urllib.request.Request(
        f'{ELEVEN_BASE}/v1/text-to-speech/{ELEVEN_VOICE}?output_format=mp3_44100_64',
        data=json.dumps({'text': text, 'model_id': ELEVEN_MODEL, 'voice_settings': {'stability': .5, 'similarity_boost': .75}}).encode(),
        headers={'Content-Type': 'application/json', 'Accept': 'audio/mpeg', 'xi-api-key': ELEVEN_KEY},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        audio = r.read()
    if len(_tts_cache) >= 300:
        _tts_cache.pop(next(iter(_tts_cache)))
    _tts_cache[key] = audio
    return audio
LANGS = {'en': 'English', 'ko': 'Korean (한국어, 해요체)', 'ja': 'Japanese (日本語, です・ます調)', 'zh': 'Simplified Chinese (简体中文)'}

SYSTEM = """You are QI (큐아이), an active museum docent agent for foreign visitors at the National Museum of Korea (Prehistory & Ancient History gallery: Goguryeo, Baekje, Gaya, Silla).
You speak to the visitor who is walking through the gallery right now, through a chat on their phone.

How to answer:
- Answer the visitor's actual question directly in the first sentence. Do not greet again, do not repeat what the card already says.
- 2 to 4 short sentences, plain words, no markdown, no lists, no emoji. Easy for a non-native listener to follow when read aloud.
- Use the FACTS block for anything specific to the object (names, places, inscriptions, materials, dates). Never invent inscriptions, dates, measurements, excavation sites or museum numbers.
- If the question goes beyond the FACTS, you may add well-established general history of that kingdom, but say so lightly ("In general, ...") and say plainly when you are not sure. If you truly do not know, say that and offer what you do know.
- Everything you say is about the CURRENT OBJECT (given below). "this", "it" and "that" mean the current object. Give information about it first, and only about it. Do not drift to other objects.
- Do NOT suggest, recommend or hint at other objects, other kingdoms, or what to see next. Never end with a question such as "which object are you curious about?". If the visitor explicitly asks about another object, answer in one or two sentences and say you can tell more when they are standing in front of it.
- You may end with ONE short follow-up about the SAME object, or with nothing at all.
- If asked where a facility is (restroom, cafe, restaurant, shop, exit, elevator), say you do not know its exact location and point to the information desk or the floor map. Never invent locations or floors.
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
            return self._json(200, {'ok': bool(KEY), 'model': MODEL, 'needCode': bool(CODE), 'tts': bool(ELEVEN_KEY)})
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

    def _gate(self):
        """본문 읽기 → 출처·접속 코드 확인. 통과하면 (본문, 접속자 주소), 막으면 응답을 보내고 None."""
        raw = self._read_body()
        if raw is None:
            self._json(413, {'error': 'too large'}); return None
        origin = self.headers.get('Origin')
        if origin and origin.split('://', 1)[-1] != self.headers.get('Host'):   # 다른 사이트에서 몰래 부르는 요청 차단
            self._json(403, {'error': 'forbidden origin'}); return None
        if CODE:
            got = urllib.parse.unquote(self.headers.get('X-QI-Code', '')).strip()
            if not hmac.compare_digest(got.encode('utf8'), CODE.encode('utf8')):
                print(f'[auth] code mismatch: got {len(got)} chars (ascii={got.isascii()}), expected {len(CODE)} chars (ascii={CODE.isascii()})', file=sys.stderr)   # 값은 기록하지 않고 길이만
                self._json(401, {'error': 'access code required'}); return None
        ip = self.client_address[0]
        if TRUST_PROXY and self.headers.get('X-Forwarded-For'):
            ip = self.headers['X-Forwarded-For'].split(',')[0].strip()
        return raw, ip

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/tts':
            return self._tts()
        if not path.startswith('/api/qi'):
            return self._json(404, {'error': 'not found'})
        if not KEY:
            self._read_body(); return self._json(503, {'error': 'OPENAI_API_KEY not set'})
        g = self._gate()
        if g is None:
            return
        raw, ip = g
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

    def _tts(self):
        if not ELEVEN_KEY:
            self._read_body(); return self._json(503, {'error': 'ELEVENLABS_API_KEY not set'})
        g = self._gate()
        if g is None:
            return
        raw, ip = g
        why = allowed(ip, _thits, _tday, TTS_RATE, TTS_DAILY)
        if why:
            return self._json(429, {'error': why})
        try:
            text = str((json.loads(raw or b'{}')).get('text', '')).strip()[:700]
            if not text:
                return self._json(400, {'error': 'empty text'})
            audio = call_eleven(text)
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(len(audio)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(audio)
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf8', 'ignore')[:300]
            print('ElevenLabs error', e.code, detail, file=sys.stderr)
            return self._json(502, {'error': f'elevenlabs {e.code}'})
        except Exception as e:
            print('tts error', repr(e), file=sys.stderr)
            return self._json(502, {'error': 'tts error'})

    def log_message(self, fmt, *a):
        if '/api/' in str(a[0] if a else ''):
            sys.stderr.write('[api] ' + (fmt % a) + '\n')


if __name__ == '__main__':
    print(f'QI server  http://localhost:{PORT}/   model={MODEL}   voice: {"ElevenLabs " + ELEVEN_VOICE if ELEVEN_KEY else "browser voices (no ELEVENLABS_API_KEY)"}   OpenAI key: {"set" if KEY else "NOT set (rule-based answers only)"}   listening on {HOST}   access code: {"on" if CODE else "OFF"}   limits: {RATE}/min, {DAILY}/day')
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
