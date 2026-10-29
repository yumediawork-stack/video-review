const fs = require('fs');
const sodium = require('libsodium-wrappers');
(async () => {
  const env = {};
  for (const line of fs.readFileSync(process.cwd() + '/.env.local', 'utf8').split('\n')) { const [k, ...r] = line.split('='); if (k) env[k] = r.join('='); }
  const repo = env.GITHUB_USER + '/video-review';
  const H = { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' };
  const pk = await fetch('https://api.github.com/repos/' + repo + '/actions/secrets/public-key', { headers: H }).then(r => r.json());
  await sodium.ready;
  function seal(value) {
    const key = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
    const enc = sodium.crypto_box_seal(sodium.from_string(value), key);
    return sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
  }
  const secrets = {
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  for (const [name, value] of Object.entries(secrets)) {
    const res = await fetch('https://api.github.com/repos/' + repo + '/actions/secrets/' + name, {
      method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: seal(value), key_id: pk.key_id })
    });
    console.log('secret', name, res.status);
  }
  const varRes = await fetch('https://api.github.com/repos/' + repo + '/actions/variables', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'VITE_BASE_PATH', value: '/video-review/' })
  });
  console.log('variable VITE_BASE_PATH', varRes.status);
})();
