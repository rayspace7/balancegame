/**
 * /api/questions, /api/vote 백엔드 예제 (Express 기준, Upstash Redis 사용)
 *
 * 왜 Redis(Upstash)가 필요한가요?
 * - Render 무료 웹 서비스는 디스크가 재배포/재시작 때마다 초기화돼요.
 *   파일이나 메모리에 투표수를 저장하면 언젠가 다 사라져요.
 * - Upstash Redis는 HTTP 기반 서버리스 Redis라서, 무료 티어로도 투표 카운터를
 *   영구적으로(재배포해도 안 사라지게) 저장할 수 있어요.
 *
 * 사용 방법
 *   npm install express @upstash/redis
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node vote.js
 *
 * Upstash 무료 DB 만들기
 *   1. https://upstash.com 가입 (GitHub 로그인 가능)
 *   2. Redis 탭 → Create Database → Region은 Render 리전과 비슷한 곳으로
 *   3. 생성된 DB 상세 페이지에서 "REST API" 섹션의
 *      UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 값을 복사
 *   4. Render의 Environment 탭에 그대로 추가
 *
 * 집계 방식
 * - 각 질문은 이미 "seed"(초기 가중치) 퍼센트를 갖고 있어요. 서비스 초반에
 *   투표가 하나도 없어도 0%/100% 같은 어색한 결과가 안 나오게 하기 위해서예요.
 * - 실제 투표수는 Redis에 계속 쌓이고, 표시되는 퍼센트 = (seed + 실제 투표수) 기준으로 계산돼요.
 * - 투표가 쌓일수록 seed의 영향력은 점점 작아지고, 진짜 사용자 선택이 결과를 주도하게 돼요.
 */

import express from 'express';
import { Redis } from '@upstash/redis';
import { QUESTIONS } from './questions-data.js';

const app = express();
app.use(express.json());

// 토스 앱 웹뷰에서 오는 크로스 오리진 요청을 허용해요.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  res.send('balance game server is running');
});

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('⚠️  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 없어요. 서버를 시작하기 전에 설정해주세요.');
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));

// 클라이언트에는 퍼센트(seed) 없이 문항 내용만 내려줘요.
// 퍼센트는 오직 "투표한 뒤"에만 알려줘서, 미리 보고 편향되게 고르는 걸 막아요.
app.get('/api/questions', (req, res) => {
  const list = QUESTIONS.map((q) => ({
    id: q.id,
    a: { emoji: q.a.emoji, text: q.a.text },
    b: { emoji: q.b.emoji, text: q.b.text },
  }));
  res.json({ questions: list });
});

app.post('/api/vote', async (req, res) => {
  try {
    const { questionId, choice } = req.body;
    const q = questionById.get(questionId);

    if (!q || (choice !== 'A' && choice !== 'B')) {
      return res.status(400).json({ error: '잘못된 요청이에요.' });
    }

    const keyA = `votes:${questionId}:A`;
    const keyB = `votes:${questionId}:B`;

    // 고른 쪽 카운터만 1 증가시키고, 두 카운터를 한 번의 왕복으로 같이 읽어와요.
    const pipeline = redis.pipeline();
    if (choice === 'A') pipeline.incr(keyA); else pipeline.get(keyA);
    if (choice === 'B') pipeline.incr(keyB); else pipeline.get(keyB);
    const [rawA, rawB] = await pipeline.exec();

    const realA = Number(rawA) || 0;
    const realB = Number(rawB) || 0;

    const totalA = q.a.seed + realA;
    const totalB = q.b.seed + realB;
    const total = totalA + totalB;

    const pctA = Math.round((totalA / total) * 100);
    const pctB = 100 - pctA;

    res.json({ pctA, pctB, totalVotes: realA + realB });
  } catch (err) {
    console.error('vote error:', err);
    res.status(500).json({ error: '투표 집계 중 문제가 생겼어요.' });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`balance game server listening on :${PORT}`);
});
