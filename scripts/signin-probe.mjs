import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const email of process.argv.slice(2)) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'TestOnly-2026-x7',
  });
  console.log(
    email,
    error ? `${error.status} ${error.message}` : `OK user=${data.user.id} session=${!!data.session}`
  );
}
