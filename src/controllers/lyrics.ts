import { LyricPlayer, EplorRenderer } from '@applemusic-like-lyrics/core';
import { appRouter } from '../components/router/appRouter';
import { playbackManager } from '../components/playback/playbackmanager';
import ServerConnections from '../components/ServerConnections';
import globalize from 'lib/globalize';
import LibraryMenu from 'scripts/libraryMenu';
import Events from 'utils/events';

import '../styles/lyrics.scss';

interface LyricLine {
    words: {
        startTime: number;
        endTime: number;
        word: string;
    }[];
    translatedLyric: string;
    romanLyric: string;
    startTime: number;
    endTime: number;
    isBG: boolean;
    isDuet: boolean;
}

interface Lyric {
    Start: number;
    Text: string;
}

let currentPlayer: any;
let currentItem: any;
let lyricsPlayer: LyricPlayer | null;
let lastUpdateTime: number | null;
let animationFrameId: number | null;
let bgRenderer: EplorRenderer;

function getCurrentTime(): number {
    return (playbackManager.currentTime() || 0) * 1000;
}

function toLyricLines(lyrics: Lyric[]): LyricLine[] {
    const groupedLyrics = new Map<number, { main: string; translation: string }>();
    for (const lyric of lyrics) {
        if (lyric.Start && lyric.Text) {
            const time = lyric.Start;
            if (!groupedLyrics.has(time)) {
                groupedLyrics.set(time, { main: '', translation: '' });
            }
            if (/[\u4e00-\u9fa5]/.test(lyric.Text)) {
                groupedLyrics.get(time)!.translation = lyric.Text;
            } else {
                groupedLyrics.get(time)!.main = lyric.Text;
            }
        }
    }

    return Array.from(groupedLyrics.entries())
        .sort(([a], [b]) => a - b)
        .map(([startTick, content], index, array) => {
            const startTime = (startTick / 10000) * 1000;
            const endTime = index < array.length - 1 ?
                (array[index + 1][0] / 10000) * 1000 :
                startTime + 5000;

            return {
                words: [{
                    startTime,
                    endTime,
                    word: content.main
                }],
                translatedLyric: content.translation,
                romanLyric: '',
                startTime,
                endTime,
                isBG: false,
                isDuet: false
            };
        });
}

function updateLyrics(currentTime: number): void {
    if (!lyricsPlayer) return;

    const now = performance.now();
    const delta = lastUpdateTime ? now - lastUpdateTime : 0;
    lastUpdateTime = now;

    lyricsPlayer.setCurrentTime(currentTime);
    lyricsPlayer.update(delta);

    animationFrameId = requestAnimationFrame(() => {
        updateLyrics(getCurrentTime());
    });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

export default function(view: HTMLElement): void {
    async function renderLyrics(lyrics: Lyric[]): Promise<void> {
        const container = view.querySelector('.dynamicLyricsContainer') as HTMLElement;
        try {
            if (lyricsPlayer) {
                lyricsPlayer.dispose();
                cancelAnimationFrame(animationFrameId!);
                animationFrameId = null;
                lastUpdateTime = null;
            }

            if (!Array.isArray(lyrics) || !lyrics.length || !lyrics.some(l => l.Start && l.Text)) {
                console.log('No valid lyrics found');
                container.innerHTML = `<h1>${globalize.translate('HeaderNoLyrics')}</h1>`;
                return;
            }

            // 清空容器
            container.innerHTML = '';

            // 创建歌词容器并添加到DOM
            const lyricsWrapper = document.createElement('div');
            lyricsWrapper.className = 'lyrics-wrapper';
            container.appendChild(lyricsWrapper);

            // 创建画布并添加到DOM
            const canvasContainer = document.createElement('canvas');
            canvasContainer.className = 'canvas-container';
            container.appendChild(canvasContainer);

            // 获取完整的专辑图片URL并添加时间戳防止缓存
            const apiClient = ServerConnections.getApiClient(currentItem.ServerId);
            const imageUrl = currentItem.ImageTags?.Primary ?
                apiClient.getImageUrl(currentItem.Id, {
                    type: 'Primary',
                    tag: currentItem.ImageTags.Primary,
                    maxHeight: 400,
                    quality: 90
                }) + `&t=${Date.now()}` : '';

            // 初始化 LyricPlayer
            lyricsPlayer = new LyricPlayer();

            // 初始化 EplorRenderer
            bgRenderer = new EplorRenderer(canvasContainer);

            if (imageUrl) {
                try {
                    console.log('Loading album image:', imageUrl);
                    const img = await loadImage(imageUrl);
                    console.log('Image loaded, setting to renderer');
                    await bgRenderer.setAlbum(img, true);
                } catch (err) {
                    console.error('Failed to load album image:', err);
                    bgRenderer.setStaticMode(true);
                }
            }

            const lyricLines = toLyricLines(lyrics);
            console.log('Converted lyric lines:', lyricLines);

            // 设置歌词
            lyricsPlayer.setLyricLines(lyricLines);
            lyricsPlayer.setCurrentTime(getCurrentTime());

            // 开始动画
            lastUpdateTime = performance.now();
            updateLyrics(getCurrentTime());
        } catch (error) {
            console.error('Error rendering lyrics:', error);
            container.innerHTML = `<h1>${globalize.translate('HeaderNoLyrics')}</h1>`;
        }
    }

    function onTimeUpdate(): void {
        if (!animationFrameId) {
            lastUpdateTime = performance.now();
            updateLyrics(getCurrentTime());
        }
    }

    async function getLyrics(itemId: string, serverId: string): Promise<Lyric[]> {
        const apiClient = ServerConnections.getApiClient(serverId);
        try {
            const response = await apiClient.ajax({
                url: apiClient.getUrl(`Audio/${itemId}/Lyrics`),
                type: 'GET'
            });
            console.log('Raw response:', response);
            const data = await response.json();
            console.log('Parsed lyrics data:', data);
            return (data?.Lyrics && Array.isArray(data.Lyrics)) ? data.Lyrics : [];
        } catch (error) {
            console.error('Error fetching lyrics:', error);
            return [];
        }
    }

    function onLoad(): void {
        const player = playbackManager.getCurrentPlayer();
        if (!player) {
            void appRouter.goHome();
            return;
        }

        currentPlayer = player;
        const state = playbackManager.getPlayerState(player);
        currentItem = state.NowPlayingItem;

        Events.on(player, 'timeupdate', onTimeUpdate);
        Events.on(player, 'playbackstart', onLoad);
        Events.on(player, 'playbackstop', () => appRouter.goHome());

        LibraryMenu.setTitle(globalize.translate('Lyrics'));
        getLyrics(currentItem.Id, currentItem.ServerId)
            .then(renderLyrics)
            .catch(() => renderLyrics([]));
    }

    view.addEventListener('viewshow', onLoad);

    view.addEventListener('viewbeforehide', () => {
        if (currentPlayer) {
            Events.off(currentPlayer, 'timeupdate', onTimeUpdate);
            Events.off(currentPlayer, 'playbackstart', onLoad);
            Events.off(currentPlayer, 'playbackstop', ()=>{});
        }
        if (lyricsPlayer) {
            cancelAnimationFrame(animationFrameId!);
            lyricsPlayer.dispose();
            lyricsPlayer = null;
            animationFrameId = null;
            lastUpdateTime = null;
        }
        lastUpdateTime = null;
        currentPlayer = null;
        currentItem = null;
    });
}
