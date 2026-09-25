import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import express, {NextFunction, Request, Response} from 'express';
import {getNintendoAccountSessionToken} from '../api/na.js';
import {ZNCA_CLIENT_ID} from '../api/coral.js';
import {getToken} from '../common/auth/coral.js';
import {getBulletToken} from '../common/auth/splatnet3.js';
import {getSettingForCoopRule, getSettingForVsMode} from '../discord/monitor/splatoon3.js';
import {initStorage, paths} from '../util/storage.js';
import {Jwt} from '../util/jwt.js';
import {CoopRule, FriendOnlineState} from 'splatnet3-types/splatnet3';

const port = Number(process.env.NXAPI_MOBILE_PORT ?? 3478);
const host = process.env.NXAPI_MOBILE_HOST ?? '0.0.0.0';
const accessKey = process.env.NXAPI_MOBILE_ACCESS_KEY ?? crypto.randomBytes(16).toString('hex');
const instanceNonce = process.env.NXAPI_MOBILE_NONCE ?? '';
const dataPath = process.env.NXAPI_DATA_PATH ?? paths.data;
const publicPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../mobile/public');
const storage = await initStorage(dataPath);

type AuthState = {verifier: string; createdAt: number};
const pending = new Map<string, AuthState>();
let splatoonPresenceCache: Record<string, unknown> | null = null;
let splatoonPresenceCacheAt = 0;
let splatnetStatusCache: 'connected' | 'error' | null = null;
let splatnetStatusDetailCache = '';
let splatoonPresenceCacheTarget = '';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '32kb'}));

function cookies(req: Request) {
    return Object.fromEntries((req.headers.cookie ?? '').split(';').filter(Boolean).map(value => {
        const [key, ...rest] = value.trim().split('=');
        return [key, decodeURIComponent(rest.join('='))];
    }));
}

function authorise(req: Request, res: Response, next: NextFunction) {
    if (req.path === '/health' || req.path.startsWith('/assets/')) return next();
    const key = req.header('x-nxapi-key') ?? req.query.key ?? cookies(req).nxapi_key;
    if (key !== accessKey) {
        if (req.path.startsWith('/api/')) return res.status(401).json({error: 'access_key_required'});
        return res.status(401).sendFile(path.join(publicPath, 'unlock.html'));
    }
    if (req.query.key === accessKey) {
        res.cookie('nxapi_key', accessKey, {httpOnly: true, sameSite: 'strict', maxAge: 31536000000});
        return res.redirect('/');
    }
    next();
}

app.use(authorise);
app.use(express.static(publicPath, {extensions: ['html']}));
app.get('/health', (_req, res) => res.json({ok: true, version: '1.6.1-mobile', nonce: instanceNonce}));

app.post('/api/auth/start', (_req, res) => {
    const state = crypto.randomBytes(36).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest().toString('base64url');
    pending.set(state, {verifier, createdAt: Date.now()});
    for (const [key, value] of pending) if (Date.now() - value.createdAt > 15 * 60_000) pending.delete(key);
    const params = new URLSearchParams({
        state,
        redirect_uri: `npf${ZNCA_CLIENT_ID}://auth`,
        client_id: ZNCA_CLIENT_ID,
        scope: 'openid user user.birthday user.mii user.screenName',
        response_type: 'session_token_code',
        session_token_code_challenge: challenge,
        session_token_code_challenge_method: 'S256',
        theme: 'login_form',
    });
    res.json({url: `https://accounts.nintendo.com/connect/1.0.0/authorize?${params}`});
});

app.post('/api/auth/complete', async (req, res, next) => {
    try {
        const url = new URL(String(req.body?.redirectUrl ?? ''));
        if (url.protocol !== `npf${ZNCA_CLIENT_ID}:` || url.host !== 'auth') throw new Error('NintendoのリダイレクトURLではありません');
        const params = new URLSearchParams(url.hash.slice(1));
        const state = params.get('state') ?? '';
        const auth = pending.get(state);
        if (!auth) throw new Error('ログイン情報の有効期限が切れました。最初からやり直してください');
        pending.delete(state);
        if (params.has('error')) throw new Error(params.get('error_description') ?? params.get('error')!);
        const code = params.get('session_token_code');
        if (!code) throw new Error('session_token_code がありません');
        const token = await getNintendoAccountSessionToken(code, auth.verifier, ZNCA_CLIENT_ID);
        const {data} = await getToken(storage, token.session_token, process.env.ZNC_PROXY_URL, false);
        const users = new Set<string>(await storage.getItem('NintendoAccountIds') ?? []);
        users.add(data.user.id);
        await storage.setItem('NintendoAccountIds', [...users]);
        await storage.setItem('SelectedUser', data.user.id);
        res.json({ok: true, user: publicAccount(data)});
    } catch (error) { next(error); }
});

async function selected() {
    const id: string | undefined = await storage.getItem('SelectedUser');
    if (!id) throw Object.assign(new Error('Nintendoアカウントを追加してください'), {status: 401});
    const token: string | undefined = await storage.getItem(`NintendoAccountToken.${id}`);
    if (!token) throw Object.assign(new Error('保存済みトークンがありません'), {status: 401});
    return {...await getToken(storage, token, process.env.ZNC_PROXY_URL), sessionToken: token};
}

function publicAccount(data: any) {
    return {id: data.user.id, nickname: data.user.nickname, screenName: data.user.screenName,
        imageUri: data.nsoAccount?.user?.imageUri, nsoName: data.nsoAccount?.user?.name};
}

function splatoonModeName(mode: string, id: string, fallback: string) {
    if (mode === 'REGULAR') return 'ナワバリバトル';
    if (id === 'VnNNb2RlLTI=') return 'バンカラマッチ（チャレンジ）';
    if (id === 'VnNNb2RlLTUx') return 'バンカラマッチ（オープン）';
    if (mode === 'BANKARA') return 'バンカラマッチ';
    if (id === 'VnNNb2RlLTY=') return 'フェスマッチ（オープン）';
    if (id === 'VnNNb2RlLTc=') return 'フェスマッチ（チャレンジ）';
    if (id === 'VnNNb2RlLTg=') return 'トリカラマッチ';
    if (mode === 'FEST') return 'フェスマッチ';
    if (mode === 'LEAGUE') return 'イベントマッチ';
    if (mode === 'X_MATCH') return 'Xマッチ';
    if (mode === 'PRIVATE') return 'プライベートマッチ';
    return fallback;
}

function splatoonImageUrl(value: string) {
    try {
        const image = new URL(value);
        const match = image.pathname.match(/^\/resources\/prod\/(.+)$/);
        return image.host === 'splatoon3.ink' ? image.href :
            match ? 'https://splatoon3.ink/assets/splatnet/' + match[1] : null;
    } catch { return null; }
}

function splatnetErrorDetail(error: any) {
    const code = String(error?.code ?? '');
    const status = Number(error?.response?.status ?? error?.status ?? 0);
    const message = String(error?.message ?? error ?? '不明なエラー');
    const upstream = error?.data?.error_description ?? error?.data?.error ?? error?.data?.message ??
        error?.data?.reason ?? error?.body ?? '';
    const safeUpstream = String(upstream).replace(/[A-Za-z0-9_-]{40,}/g, '[認証情報]').slice(0, 120);
    if (error?.key === 'splatnet3' && Array.isArray(error?.attempts)) return '端末内の認証保護制限に到達しました';
    if (code === 'USER_NOT_REGISTERED' || status === 204) return 'このNintendoアカウントではSplatoon 3が未登録です';
    if (code === 'ERROR_OBSOLETE_VERSION' || status === 403) return 'SplatNet 3のバージョンが古いため拒否されました';
    if (code === 'ERROR_INVALID_GAME_WEB_TOKEN' || status === 401) return 'SplatNet 3の認証トークンが拒否されました';
    if (code === 'ERROR_RATE_LIMIT' || status === 429) return 'アクセス回数制限中です。しばらく待ってください';
    if (/Invalid web service/i.test(message)) return 'NintendoアカウントでSplatNet 3を利用できません';
    if (/Remote configuration/i.test(message)) return 'SplatNet 3の設定を読み込めません';
    if (status) return `HTTP ${status}${safeUpstream ? ` / ${safeUpstream}` : ''}`;
    return message.replace(/[A-Za-z0-9_-]{40,}/g, '[認証情報]').slice(0, 160);
}

function splatnetRetryAt(error: any, stage: 'authentication' | 'api') {
    if (error?.key === 'splatnet3' && Array.isArray(error?.attempts)) {
        const times = error.attempts.map((attempt: any) => Number(attempt?.time)).filter(Number.isFinite);
        if (times.length) return Math.min(...times) + 60 * 60_000 + 2_000;
    }
    return Date.now() + (stage === 'authentication' ? 15 * 60_000 : 5 * 60_000);
}

app.get('/api/me', async (_req, res, next) => {
    try { const {data} = await selected(); res.json(publicAccount(data)); } catch (error) { next(error); }
});
app.get('/api/presence-targets', async (_req, res, next) => {
    try {
        const {nso, data} = await selected();
        const friends = (await nso.getFriendList()).friends;
        const key = `PresenceTarget.${data.user.id}`;
        let selectedNsaId: string = await storage.getItem(key) ?? '';
        if (selectedNsaId && !friends.some(friend => friend.nsaId === selectedNsaId)) {
            selectedNsaId = '';
            await storage.removeItem(key);
        }
        res.json({selectedNsaId, friends: friends.map(friend => ({
            nsaId: friend.nsaId, name: friend.name, imageUri: friend.imageUri,
            gameName: 'name' in friend.presence.game ? friend.presence.game.name : '',
        }))});
    } catch (error) { next(error); }
});
app.put('/api/presence-target', async (req, res, next) => {
    try {
        const {nso, data} = await selected();
        const nsaId = String(req.body?.nsaId ?? '');
        if (nsaId && !(await nso.getFriendList()).friends.some(friend => friend.nsaId === nsaId)) {
            return res.status(400).json({error: '選択したユーザーはフレンド一覧にありません'});
        }
        const key = `PresenceTarget.${data.user.id}`;
        if (nsaId) await storage.setItem(key, nsaId); else await storage.removeItem(key);
        splatoonPresenceCache = null;
        splatoonPresenceCacheAt = 0;
        splatnetStatusCache = null;
        splatnetStatusDetailCache = '';
        splatoonPresenceCacheTarget = '';
        res.json({ok: true, selectedNsaId: nsaId});
    } catch (error) { next(error); }
});
app.get('/api/presence', async (_req, res, next) => {
    try {
        const {nso, data, sessionToken} = await selected();
        const currentUser = await nso.getCurrentUser();
        const targetNsaId: string = await storage.getItem(`PresenceTarget.${data.user.id}`) ?? '';
        let user: typeof currentUser | Awaited<ReturnType<typeof nso.getFriendList>>['friends'][number] = currentUser;
        if (targetNsaId) {
            const target = (await nso.getFriendList()).friends.find(friend => friend.nsaId === targetNsaId);
            if (target) user = target;
        }
        let splatoon3: Record<string, unknown> | null = null;
        let splatnet3Status: 'connected' | 'error';
        let splatnet3Detail = '';
        const game = 'name' in user.presence.game ? user.presence.game : null;
        const isPlayingSplatoon3 = !!game && /splatoon\s*3|スプラトゥーン\s*3/i.test(game.name);
        const failureKey = `SplatnetFailure.${data.user.id}`;
        const savedFailure: {retryAt: number; detail: string} | undefined = await storage.getItem(failureKey);
        if (savedFailure && savedFailure.retryAt > Date.now()) {
            splatnet3Status = 'error';
            splatnet3Detail = `${savedFailure.detail}（${new Date(savedFailure.retryAt).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}以降に再試行）`;
        } else if (Date.now() - splatoonPresenceCacheAt < 20_000 && splatnetStatusCache &&
            splatoonPresenceCacheTarget === targetNsaId) {
            splatoon3 = splatoonPresenceCache;
            splatnet3Status = splatnetStatusCache;
            splatnet3Detail = splatnetStatusDetailCache;
        } else {
            let splatnetStage: 'authentication' | 'api' = 'authentication';
            try {
                const {splatnet} = await getBulletToken(storage, sessionToken,
                    process.env.ZNC_PROXY_URL, true);
                splatnetStage = 'api';
                const schedules = await splatnet.getSchedules();
                const friends = isPlayingSplatoon3 && targetNsaId ? await splatnet.getFriendsRefetch() : null;
                const friendId = Buffer.from('Friend-' + user.nsaId).toString('base64');
                const friend = friends?.data.friends.nodes.find(value => value.id === friendId) ?? null;
                if (friend) {
                    let details = '';
                    let state = '';
                    let imageUri = game?.imageUri ?? user.imageUri;
                    if ((friend.onlineState === FriendOnlineState.VS_MODE_MATCHING ||
                        friend.onlineState === FriendOnlineState.VS_MODE_FIGHTING) && friend.vsMode) {
                        const modeName = splatoonModeName(friend.vsMode.mode, friend.vsMode.id, friend.vsMode.name);
                        const setting = getSettingForVsMode(schedules.data, friend.vsMode);
                        const rule = setting && 'vsRule' in setting ? setting.vsRule.name : '';
                        details = [...new Set([modeName, rule].filter(Boolean))].join('・') +
                            (friend.onlineState === FriendOnlineState.VS_MODE_MATCHING ? '（マッチング中）' : '');
                        if (setting?.vsStages?.length) {
                            state = setting.vsStages.map(stage => stage.name).join(' / ');
                            imageUri = 'https://fancy.org.uk/api/nxapi/s3/image?' + new URLSearchParams({
                                a: setting.vsStages[0].id,
                                b: setting.vsStages[1]?.id ?? setting.vsStages[0].id,
                                v: '2022092400',
                            }).toString();
                        }
                    } else if (friend.onlineState === FriendOnlineState.COOP_MODE_MATCHING ||
                        friend.onlineState === FriendOnlineState.COOP_MODE_FIGHTING) {
                        const coopName = friend.coopRule === CoopRule.BIG_RUN ? 'ビッグラン' :
                            friend.coopRule === CoopRule.TEAM_CONTEST ? 'バイトチームコンテスト' : 'サーモンラン';
                        details = coopName + (friend.onlineState === FriendOnlineState.COOP_MODE_MATCHING ?
                            '（マッチング中）' : '');
                        const setting = getSettingForCoopRule(schedules.data.coopGroupingSchedule,
                            friend.coopRule as CoopRule);
                        if (setting) {
                            state = setting.coopStage.name;
                            imageUri = splatoonImageUrl(setting.coopStage.image.url) ?? imageUri;
                        }
                    } else if (friend.onlineState === FriendOnlineState.MINI_GAME_PLAYING) {
                        details = 'ナワバトラー';
                    }
                    if (details) splatoon3 = {details, state, imageUri, onlineState: friend.onlineState};
                }
                splatoonPresenceCache = splatoon3;
                splatoonPresenceCacheAt = Date.now();
                splatoonPresenceCacheTarget = targetNsaId;
                splatnet3Status = 'connected';
                splatnet3Detail = isPlayingSplatoon3 && !targetNsaId ?
                    '接続済み（詳細表示には監視対象を選択）' :
                    isPlayingSplatoon3 && !friend ? '接続済み（プレイ状態の反映待ち）' : '接続・認証成功';
                splatnetStatusCache = splatnet3Status;
                splatnetStatusDetailCache = splatnet3Detail;
                await storage.removeItem(failureKey);
            } catch (error) {
                splatnet3Status = 'error';
                splatnet3Detail = splatnetErrorDetail(error);
                const retryAt = splatnetRetryAt(error, splatnetStage);
                await storage.setItem(failureKey, {retryAt, detail: splatnet3Detail});
                splatnet3Detail += `（${new Date(retryAt).toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}以降に再試行）`;
                splatoonPresenceCache = null;
                splatoonPresenceCacheAt = Date.now();
                splatoonPresenceCacheTarget = targetNsaId;
                splatnetStatusCache = splatnet3Status;
                splatnetStatusDetailCache = splatnet3Detail;
                console.error('SplatNet 3 presence update failed', error);
            }
        }
        res.json({name: user.name, imageUri: user.imageUri, presence: user.presence,
            splatoon3, splatnet3Status, splatnet3Detail});
    } catch (error) { next(error); }
});
app.get('/api/friends', async (_req, res, next) => {
    try { const {nso} = await selected(); res.json((await nso.getFriendList()).friends); } catch (error) { next(error); }
});
app.get('/api/webservices', async (_req, res, next) => {
    try { const {nso} = await selected(); res.json(await nso.getWebServices()); } catch (error) { next(error); }
});
app.get('/api/announcements', async (_req, res, next) => {
    try { const {nso} = await selected(); res.json(await nso.getAnnouncements()); } catch (error) { next(error); }
});
app.get('/api/active-event', async (_req, res, next) => {
    try { const {nso} = await selected(); res.json(await nso.getActiveEvent()); } catch (error) { next(error); }
});
app.delete('/api/account', async (_req, res, next) => {
    try {
        const id: string | undefined = await storage.getItem('SelectedUser');
        if (id) {
            const ids: string[] = await storage.getItem('NintendoAccountIds') ?? [];
            const token: string | undefined = await storage.getItem(`NintendoAccountToken.${id}`);
            await storage.setItem('NintendoAccountIds', ids.filter(value => value !== id));
            await storage.removeItem(`NintendoAccountToken.${id}`);
            if (token) await Promise.all([
                storage.removeItem(`NsoToken.${token}`),
                storage.removeItem(`NaToken.${token}`),
                storage.removeItem(`NaTokenError.${token}`),
                storage.removeItem(`BulletToken.${token}`),
            ]);
            await Promise.all([
                storage.removeItem(`PresenceTarget.${id}`),
                storage.removeItem(`SplatnetFailure.${id}`),
                storage.removeItem(`RateLimitAttempts-na.${id}`),
                storage.removeItem(`RateLimitAttempts-coral.${id}`),
                storage.removeItem(`RateLimitAttempts-splatnet3.${id}`),
            ]);
            await storage.removeItem('SelectedUser');
        }
        res.status(204).end();
    } catch (error) { next(error); }
});

app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    const upstreamStatus = error.response?.status;
    const upstreamData = error.data;
    const upstreamDetail = upstreamData?.error_description ?? upstreamData?.error ??
        upstreamData?.reason ?? upstreamData?.message;
    const suffix = [upstreamStatus ? `HTTP ${upstreamStatus}` : '', upstreamDetail]
        .filter(Boolean).join(' / ');
    const message = error.message ?? String(error);
    res.status(error.status ?? 500).json({
        error: suffix ? `${message} (${suffix})` : message,
        upstreamStatus,
        upstreamError: upstreamData?.error,
    });
});

app.listen(port, host, () => {
    console.log(`nxapi mobile server started on ${host}:${port}`);
});
