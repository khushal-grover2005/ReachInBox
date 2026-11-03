import { redis } from './queue.js';

const reserveScript = `
local existing = redis.call('GET', KEYS[4])
if existing then
  local reserved = tonumber(existing)
  if reserved > tonumber(ARGV[1]) then
    return { reserved, 0, 0 }
  end
  redis.call('DEL', KEYS[4])
  return { 0, 0, 0 }
end

local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local campaignLimit = tonumber(ARGV[4])
local campaignPrefix = ARGV[5]
local due = math.max(now, tonumber(redis.call('GET', KEYS[1]) or now))
local hitLimit = 0
local hitWindow = 0

for _ = 1, 100 do
  local window = math.floor(due / 3600000)
  local senderKey = KEYS[2] .. ':' .. window
  local campaignKey = campaignPrefix .. ':' .. window
  local senderCount = tonumber(redis.call('GET', senderKey) or 0)
  local campaignCount = tonumber(redis.call('GET', campaignKey) or 0)
  if senderCount < senderLimit and campaignCount < campaignLimit then
    redis.call('INCR', senderKey)
    redis.call('EXPIRE', senderKey, 172800)
    redis.call('INCR', campaignKey)
    redis.call('EXPIRE', campaignKey, 172800)
    redis.call('SET', KEYS[1], due + interval, 'EX', 172800)
    redis.call('SET', KEYS[4], due, 'EX', 172800)
    return { due, hitLimit, hitWindow }
  end
  hitLimit = 1
  hitWindow = window * 3600000
  due = (window + 1) * 3600000
end
return { due, hitLimit, hitWindow }
`;

export async function reserveSendSlot(input: {
  senderId: string;
  campaignId: string;
  emailId: string;
  now: number;
  intervalMs: number;
  senderLimit: number;
  campaignLimit: number;
}): Promise<{ dueAt: number; rateLimited: boolean; windowStart: number }> {
  const senderKey = `send:next:${input.senderId}`;
  const senderBucketPrefix = `send:sender:${input.senderId}`;
  const reservationKey = `send:reservation:${input.emailId}`;
  const campaignBucketPrefix = `send:campaign:${input.campaignId}`;
  const result = await redis.eval(
    reserveScript,
    4,
    senderKey,
    senderBucketPrefix,
    campaignBucketPrefix,
    reservationKey,
    input.now,
    input.intervalMs,
    input.senderLimit,
    input.campaignLimit,
    campaignBucketPrefix,
  ) as [number, number, number];
  return { dueAt: Number(result[0]), rateLimited: Number(result[1]) === 1, windowStart: Number(result[2]) };
}

export async function claimRateLimitNotification(senderId: string, windowStart: number): Promise<boolean> {
  const claimed = await redis.set(`send:rate-notified:${senderId}:${windowStart}`, '1', 'EX', 172800, 'NX');
  return claimed === 'OK';
}
