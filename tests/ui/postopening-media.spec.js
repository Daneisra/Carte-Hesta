const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { PNG } = require('../fixtures/application.cjs');

function wav(seconds) {
  const bytes = Buffer.alloc(44 + seconds * 16000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}

test('post-ouverture : CSP autorise les portraits Discord sans exposer de profil', async ({ page }) => {
  const avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
  const portrait = 'https://media.discordapp.net/attachments/synthetic/character.png';
  const loaded = [];
  for (const url of [avatar, portrait]) await page.route(url, route => { loaded.push(url); return route.fulfill({ contentType: 'image/png', body: PNG }); });
  await page.route('**/auth/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, role: 'user', username: 'Fiction', avatar, provider: 'discord', groups: [], characters: [{ name: 'Fiction', avatar: portrait }], account: {}, profile: {} }) }));
  const response = await page.goto('/');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain('https://cdn.discordapp.com'); expect(csp).not.toContain('https:;');
  await expect(page.locator('#home-avatar')).toHaveCSS('background-image', `url("${avatar}")`);
  await expect.poll(() => loaded.includes(avatar)).toBe(true);
  expect(await page.evaluate(async url => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); img.src = url; }), portrait)).toBe(true);
  const absent = 'https://cdn.discordapp.com/attachments/synthetic/missing.png';
  await page.route(absent, route => route.fulfill({ status: 404, body: 'Not Found' }));
  await page.evaluate(async ({ absent, portrait }) => {
    const { setAvatarImage } = await import('../../js/ui/avatar.mjs');
    const failed = document.createElement('span'); failed.id = 'synthetic-avatar-missing'; document.body.append(failed); setAvatarImage(failed, absent, 'Personnage', 'has-image');
    const stale = document.createElement('span'); stale.id = 'synthetic-avatar-stale'; document.body.append(stale); setAvatarImage(stale, portrait, 'Ancien'); setAvatarImage(stale, '', 'Invite');
  }, { absent, portrait });
  await expect(page.locator('#synthetic-avatar-missing')).toHaveText('P');
  await expect(page.locator('#synthetic-avatar-missing')).not.toHaveClass(/has-image/);
  await expect(page.locator('#synthetic-avatar-stale')).toHaveText('I');
  await expect(page.locator('#synthetic-avatar-stale')).toHaveCSS('background-image', 'none');
});

test('post-ouverture : miniatures YouTube, referent origine et fallback du lecteur', async ({ page, baseURL }) => {
  const frameReferrers = [];
  page.on('request', r => { if (r.url().startsWith('https://www.youtube.com/embed/')) frameReferrers.push(r.headers().referer); });
  await page.goto('/?synthetic-private-query=not-forwarded');
  await page.evaluate(async () => {
    const { InfoPanel } = await import('../../js/ui/infoPanel.js');
    const { LocationEditor } = await import('../../js/ui/locationEditor.js');
    const panel = Object.create(InfoPanel.prototype);
    const thumbnail = panel.createVideoThumbnail({ videoEntry: 'https://youtu.be/testVideo01?si=synthetic', location: { name: 'Fiction' }, index: 0 });
    thumbnail.element.id = 'synthetic-video-thumbnail'; document.body.append(thumbnail.element);
    const videoPreview = document.createElement('div'); videoPreview.id = 'synthetic-video-preview'; document.body.append(videoPreview);
    LocationEditor.prototype.updateVideoPreview.call({ videoPreview, collectVideos: () => [{ url: 'https://www.youtube.com/watch?v=testVideo01', title: 'Vidéo fictive' }, { url: 'https://youtu.be/testVideo02?si=synthetic', title: 'Autre fiction' }] });
  });
  await expect.poll(() => page.locator('#synthetic-video-thumbnail img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const frames = page.locator('#synthetic-video-preview iframe'); await expect(frames).toHaveCount(2);
  for (const frame of await frames.all()) { await frame.scrollIntoViewIfNeeded(); await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin'); await expect(frame).toHaveAttribute('src', /https:\/\/www.youtube.com\/embed\/testVideo0[12]$/); }
  await expect(page.frameLocator('#synthetic-video-preview iframe').first().locator('p')).toHaveText('Contenu de test local');
  await expect(page.locator('#synthetic-video-preview a')).toHaveCount(2);
  await expect(page.locator('#synthetic-video-preview a').first()).toContainText('indisponible');
  await expect.poll(() => frameReferrers.length).toBe(2); expect(frameReferrers.every(value => value === baseURL + '/')).toBe(true);
  await page.locator('#synthetic-video-thumbnail img').evaluate(img => img.dispatchEvent(new Event('error')));
  await expect(page.locator('#synthetic-video-thumbnail a')).toContainText('Fiction');
});

test('post-ouverture : navigation audio courte et longue, metadonnees et changement de lieu', async ({ page }) => {
  await loginAsSyntheticAdmin(page);
  const audios = [];
  for (const seconds of [10, 90]) {
    const upload = await page.request.post('/api/upload', { data: { type: 'audio', filename: `synthetic-${seconds}.wav`, data: wav(seconds).toString('base64') } });
    expect(upload.status()).toBe(200); audios.push({ path: '/' + (await upload.json()).path, seconds });
  }
  await page.goto('/');
  await page.evaluate(async () => {
    const { AudioManager } = await import('../../js/ui/audioManager.js');
    const container = document.createElement('div'); container.id = 'synthetic-audio';
    const player = document.createElement('audio'), progressBar = document.createElement('input'), titleElement = document.createElement('p'), currentLabel = document.createElement('span');
    progressBar.type = 'range'; progressBar.min = '0'; progressBar.max = '100'; progressBar.step = '0.1';
    container.append(player, progressBar, titleElement, currentLabel); document.body.append(container);
    window.syntheticAudio = new AudioManager({ player, progressBar, titleElement, currentLabel, container }); window.syntheticAudio.initialize();
  });
  for (const audio of audios) {
    await page.evaluate(audio => window.syntheticAudio.update({ location: { name: 'Fiction', audio: audio.path } }), audio);
    await expect.poll(() => page.evaluate(() => Math.round(window.syntheticAudio.player.duration))).toBe(audio.seconds);
    await page.evaluate(() => window.syntheticAudio.player.pause());
    await expect(page.locator('#synthetic-audio input')).toBeEnabled();
    const preview = await page.evaluate(() => {
      const a = window.syntheticAudio; a.progressBar.value = '75'; a.progressBar.dispatchEvent(new Event('input')); a.player.dispatchEvent(new Event('timeupdate'));
      return { slider: Number(a.progressBar.value), time: a.player.currentTime };
    });
    expect(preview.slider).toBe(75); expect(preview.time).toBeLessThan(audio.seconds * 0.5);
    await page.evaluate(() => window.syntheticAudio.progressBar.dispatchEvent(new Event('change')));
    await expect.poll(() => page.evaluate(() => window.syntheticAudio.player.currentTime)).toBeCloseTo(audio.seconds * 0.75, 1);
    const partial = await page.request.get(audio.path, { headers: { Range: 'bytes=40-79' } }); expect(partial.status()).toBe(206); expect((await partial.body()).length).toBe(40);
    expect((await page.request.get(audio.path, { headers: { Range: 'bytes=99999999-' } })).status()).toBe(416);
  }
  await page.evaluate(() => {
    const a = window.syntheticAudio; Object.defineProperty(a.player, 'duration', { configurable: true, value: Infinity }); a.player.dispatchEvent(new Event('durationchange'));
  });
  await expect(page.locator('#synthetic-audio input')).toBeDisabled();
  await page.evaluate(() => { const a = window.syntheticAudio; Object.defineProperty(a.player, 'duration', { configurable: true, value: 90 }); a.player.dispatchEvent(new Event('durationchange')); });
  await expect(page.locator('#synthetic-audio input')).toBeEnabled();
});
