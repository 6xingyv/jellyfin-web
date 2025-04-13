import { LyricPlayer, EplorRenderer } from '@applemusic-like-lyrics/core';
import { appRouter } from '../components/router/appRouter';
import { playbackManager } from '../components/playback/playbackmanager';
import ServerConnections from '../components/ServerConnections';
import globalize from 'lib/globalize';
import LibraryMenu from 'scripts/libraryMenu';
import Events from 'utils/events';

import '../styles/lyrics.scss';

let currentPlayer;
let currentItem;
let lyricsPlayer;
let lastUpdateTime;
let animationFrameId;
let bgRenderer:EplorRenderer;

function getCurrentTime() {
    return (playbackManager.currentTime() || 0) * 1000; // 转换为毫秒
}

function toLyricLines(lyrics) {
    // 按时间分组整理歌词
    const groupedLyrics = new Map();
    for (const lyric of lyrics) {
        if (lyric.Start && lyric.Text) {
            const time = lyric.Start;
            if (!groupedLyrics.has(time)) {
                groupedLyrics.set(time, { main: '', translation: '' });
            }
            if (/[\u4e00-\u9fa5]/.test(lyric.Text)) {
                groupedLyrics.get(time).translation = lyric.Text;
            } else {
                groupedLyrics.get(time).main = lyric.Text;
            }
        }
    }

    // 转换为 LyricLine 数组
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

function updateLyrics(currentTime) {
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

export default function (view) {
    function renderLyrics(lyrics) {
        const container = view.querySelector('.dynamicLyricsContainer');
        try {
            if (lyricsPlayer) {
                lyricsPlayer.dispose();
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                lastUpdateTime = null;
            }

            // 检查歌词数组是否有效
            if (!Array.isArray(lyrics) || !lyrics.length || !lyrics.some(l => l.Start && l.Text)) {
                console.log('No valid lyrics found');
                container.innerHTML = `<h1>${globalize.translate('HeaderNoLyrics')}</h1>`;
                return;
            }

            lyricsPlayer = new LyricPlayer({
                enableBlur: true,
                enableSpring: true
            });

            bgRenderer = new EplorRenderer({
                container: container,
                enableBlur: true,
                enableSpring: true
            });

            bgRenderer.setLyricPlayer(lyricsPlayer);

            const lyricLines = toLyricLines(lyrics);
            console.log('Converted lyric lines:', lyricLines);

            container.innerHTML = '';
            container.appendChild(lyricsPlayer.getElement());

            // 设置歌词和初始时间
            lyricsPlayer.setLyricLines(lyricLines);
            lyricsPlayer.setCurrentTime(getCurrentTime());

            // 开始动画循环
            lastUpdateTime = performance.now();
            updateLyrics(getCurrentTime());
        } catch (error) {
            console.error('Error rendering lyrics:', error);
            container.innerHTML = `<h1>${globalize.translate('HeaderNoLyrics')}</h1>`;
        }
    }

    function onTimeUpdate() {
        if (!animationFrameId) {
            lastUpdateTime = performance.now();
            updateLyrics(getCurrentTime());
        }
    }

    function getLyrics(itemId, serverId) {
        const apiClient = ServerConnections.getApiClient(serverId);
        return apiClient.ajax({
            url: apiClient.getUrl(`Audio/${itemId}/Lyrics`),
            type: 'GET'
        }).then(async response => {
            console.log('Raw response:', response);
            // 解析响应体
            const data = await response.json();
            console.log('Parsed lyrics data:', data);
            return (data?.Lyrics && Array.isArray(data.Lyrics)) ? data.Lyrics : [];
        }).catch(error => {
            console.error('Error fetching lyrics:', error);
            return [];
        });
    }

    function onLoad() {
        const player = playbackManager.getCurrentPlayer();
        if (!player) {
            appRouter.goHome();
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
            Events.off(currentPlayer, 'playbackstop');
        }
        if (lyricsPlayer) {
            cancelAnimationFrame(animationFrameId);
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
