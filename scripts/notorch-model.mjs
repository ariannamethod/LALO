// Optional Node adapter. NoTorch owns tokenization, decoding and expert updates.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const NOTORCH_BINARY = fileURLToPath(new URL('../deps/notorch/notorch', import.meta.url));
export const GEMMA_270M = Object.freeze({
  name: 'Gemma 3-270M-IT Q8_0',
  repository: 'ggml-org/gemma-3-270m-it-GGUF',
  revision: 'e7647be17ae1108f2f605ed061ca0608b171afff',
  filename: 'gemma-3-270m-it-Q8_0.gguf',
  sha256: '0ef57d2c838458a1952664260dcba38e5bdda37494f3af732f06e4add24068e3',
});
export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
const fail = (code, message) => Object.assign(new Error(message), { code });
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
async function fileStamp(path) {
  const s = await stat(path, { bigint: true });
  if (!s.isFile()) throw fail('MODEL_PATH', 'Model artifacts must be regular files');
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
}

export async function createNoTorchModel({ model, executable = NOTORCH_BINARY,
  maxTokens = 96, timeoutMs = 120_000, expertsDirectory, sporeIn } = {}) {
  if (typeof model !== 'string' || !model) throw fail('MODEL_PATH', 'Supply a local Gemma GGUF');
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 256
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw fail('MODEL_BUDGET', 'Expected 1..256 tokens and a deadline up to 120000 ms');
  if (sporeIn && !expertsDirectory) throw fail('MODEL_STATE', 'Expert restore needs a new output directory');
  model = await realpath(resolve(model)); executable = await realpath(resolve(executable));
  const modelStamp = await fileStamp(model), runtimeStamp = await fileStamp(executable);
  if (await fileDigest(model) !== GEMMA_270M.sha256)
    throw fail('MODEL_PROFILE', 'This adapter requires the pinned Gemma 3-270M-IT Q8_0 file');
  const identity = Object.freeze({ ...GEMMA_270M, runtime: 'notorch', runtimeSha256: await fileDigest(executable),
    profile: 'gemma3-270m-it-chat/v1', experts: Boolean(expertsDirectory) });
  let current = sporeIn ? await realpath(resolve(sporeIn)) : null, busy = false, stopped = false, turn = 0;
  if (expertsDirectory) {
    expertsDirectory = resolve(expertsDirectory);
    await mkdir(expertsDirectory, { recursive: false, mode: 0o700 });
  }
  // The entire numerical configuration is explicit. An inherited NT_TOKENS or
  // sampling override must not substitute a different prompt or arithmetic.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NT_')));
  Object.assign(env, { NT_CHAT: '||106', NT_QMV_THREADS: '2', NT_ATTN_THREADS: '1', NT_BLAS_THREADS: '1',
    NT_NO_I8: '1', NT_ECHO_IDS: '1' });
  const run = async (args, extra = {}) => {
    try { return await exec(executable, args, { env: { ...env, ...extra }, encoding: 'buffer',
      timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 2_000_000 }); }
    catch (error) { throw fail('MODEL_PROCESS', `NoTorch failed: ${String(error.code || error.message).slice(0, 200)}`); }
  };
  async function unchangedBody() {
    if (await fileStamp(model) !== modelStamp || await fileStamp(executable) !== runtimeStamp)
      throw fail('MODEL_CHANGED', 'Weights or native executable changed during this adapter lifetime');
  }
  await unchangedBody();
  return Object.freeze({ identity,
    async generate({ prompt }) {
      if (busy) throw fail('MODEL_BUSY', 'One generation may run at a time');
      if (stopped) throw fail('MODEL_STOPPED', 'A failed generation ended this model adapter');
      if (typeof prompt !== 'string' || !prompt.trim() || !prompt.isWellFormed() || prompt.includes('\0')
        || Buffer.byteLength(prompt) > 16_384) throw fail('MODEL_PROMPT', 'Prompt must fit 16384 UTF-8 bytes');
      busy = true;
      try {
        await unchangedBody();
        const tokenized = utf8((await run(['-T', model, prompt])).stdout).trim();
        if (!/^\d+(,\d+)*$/.test(tokenized)) throw fail('MODEL_TOKENIZER', 'Malformed tokenizer output');
        const content = tokenized.split(',').map(Number);
        if (content[0] !== 2 || content.length >= 8192) throw fail('MODEL_TOKENIZER', 'Missing BOS or exhausted tokenizer budget');
        // IDs and wrapping are read from this exact GGUF's vocabulary/template.
        // bpe_encode supplies BOS: move it ahead of the user turn, exactly once.
        const ids = [2, 105, 2364, 107, ...content.slice(1), 106, 107, 105, 4368, 107];
        if (ids.length + maxTokens + 1 >= 8192) throw fail('MODEL_PROMPT', 'Prompt exceeds native context budget');
        const before = current ? await fileDigest(current) : null;
        const next = expertsDirectory ? join(expertsDirectory, `${String(++turn).padStart(4, '0')}.gguf`) : null;
        const flags = next ? ['--experts', '--learn-experts', '--expert-trace',
          ...(current ? ['--spore-in', current] : []), '--spore-out', next] : [];
        const { stdout, stderr } = await run(['-q', ...flags, '-n', String(maxTokens), '-t', '0', model, prompt],
          { NT_TOKENS: ids.join(',') });
        const output = utf8(stdout), diagnostic = utf8(stderr);
        if (!output.startsWith(prompt) || !output.endsWith('\n')) throw fail('MODEL_PROTOCOL', 'Native prompt echo or framing changed');
        const text = output.slice(prompt.length, -1);
        if (!text.trim() || text.length > 4096) throw fail('MODEL_OUTPUT', 'Empty or oversized model utterance');
        // Remove the complete echoed prompt before parsing native measurements.
        const marker = `\nprompt: "${prompt}" (`;
        const start = diagnostic.indexOf(marker);
        if (start < 0) throw fail('MODEL_PROTOCOL', 'Missing native prompt boundary');
        const native = diagnostic.slice(start + marker.length);
        const stats = /── prefill: (\d+) tok [^\n]*\| decode: (\d+) tok /.exec(native);
        const choices = [...native.matchAll(/\[id (\d+)\]/g)].map(m => Number(m[1]));
        if (!stats || Number(stats[1]) !== ids.length || !choices.length)
          throw fail('MODEL_PROTOCOL', 'Missing or inconsistent native generation counts');
        const outputTokens = Number(stats[2]);
        if (choices.length !== outputTokens && choices.length !== outputTokens + 1)
          throw fail('MODEL_PROTOCOL', 'Native choice and output counts differ');
        const stateAfter = next ? await fileDigest(next) : null;
        await unchangedBody();
        const metadata = { inputTokens: ids.length, outputTokens, choices,
          finishReason: choices.length === outputTokens + 1 ? 'stop' : 'length',
          maxTokens, temperature: 0, threads: 2, floatActivations: true,
          stateBefore: before, stateAfter, diagnosticSha256: createHash('sha256').update(stderr).digest('hex') };
        if (next) current = next;
        return { text, metadata };
      } catch (error) { stopped = true; throw error; }
      finally { busy = false; }
    },
    state: () => current,
  });
}
