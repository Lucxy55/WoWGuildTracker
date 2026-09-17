import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'tracker.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { characters: [] }; }
  if (!Array.isArray(state.characters)) throw new Error('Invalid tracker data');
  if (state.events === undefined) state.events = [];
  if (!Array.isArray(state.events)) throw new Error('Invalid calendar data');
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    update(fn) {
      const operation = queue.then(async () => {
        const next = structuredClone(state);
        const result = fn(next);
        await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        state = next;
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
