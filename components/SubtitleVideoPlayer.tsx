// SubtitleVideoPlayer.tsx
// Works in Expo with React Native on iOS, Android, desktop web & mobile web.
// Renders accurate WebVTT subtitles by parsing and syncing them to the Video time.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, Pressable, ViewStyle, DimensionValue } from 'react-native';
import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';

/** Utility: convert WebVTT timestamp --> seconds */
function vttTimeToSeconds(t: string): number {
  // formats like: 00:00:02.000 or 00:02:03.45
  const m = t.trim().match(/^(\d{2}):(\d{2}):(\d{2})([\.,](\d{1,3}))?$/);
  if (!m) return 0;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ms = m[5] ? parseInt(m[5].padEnd(3, '0'), 10) : 0; // normalize to ms
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

export type VttCue = {
  start: number; // seconds
  end: number;   // seconds
  text: string;  // combined lines (with \n)
  settings?: string;
};

/** Minimal WebVTT parser (ignores STYLE/NOTE/REGION blocks) */
function parseWebVTT(data: string): VttCue[] {
  const lines = data.replace(/\r/g, '').split('\n');
  const cues: VttCue[] = [];
  let i = 0;

  // Skip header until a time line appears
  if (lines[i] && /^WEBVTT/i.test(lines[i])) {
    // Skip possible header metadata lines
    while (i < lines.length && lines[i].trim() !== '') i++;
  }

  while (i < lines.length) {
    // Skip empty / NOTE blocks
    if (lines[i].trim() === '' || /^NOTE($|\s)/.test(lines[i])) {
      i++;
      continue;
    }

    // Optional cue id
    if (!/-->/.test(lines[i])) {
      // likely an ID line, advance
      i++;
    }

    if (i >= lines.length) break;

    // Timing line
    const timing = lines[i];
    if (!/-->/.test(timing)) {
      i++;
      continue;
    }

    const [startRaw, rest] = timing.split(/\s+-->\s+/);
    let endRaw = rest;
    let settings = '';
    // end time may include settings after space
    const endParts = rest.split(/\s+/);
    if (endParts.length > 1) {
      endRaw = endParts[0];
      settings = endParts.slice(1).join(' ');
    }

    const start = vttTimeToSeconds(startRaw);
    const end = vttTimeToSeconds(endRaw);
    i++;

    // Collect text lines until empty or EOF
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }

    cues.push({ start, end, text: textLines.join('\n'), settings });

    // Skip blank separator
    while (i < lines.length && lines[i].trim() === '') i++;
  }

  return cues.sort((a, b) => a.start - b.start);
}

export type SubtitleVideoPlayerProps = {
  /** MP4/HLS URL or require() module */
  source?: any;
  /** Remote/local .vtt URL; if omitted, uses built-in demo track */
  subtitleUrl?: string;
  /** Start auto-playing */
  autoPlay?: boolean;
  /** Show native platform controls */
  controls?: boolean;
  /** Change caption font size */
  captionFontSize?: number;
  /** Container height (optional - uses aspect ratio if not provided) */
  height?: number | string;
  /** Container width */
  width?: number | string;
};

const DEMO_VIDEO = {
  uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
};

// Note: YouTube URLs like 'https://youtu.be/BSJa1UytM8w?si=wiHpmIuGv5uYn2el'
// don't work directly in video players. You need to:
// 1. Download the video and use it as a local file, or
// 2. Use a direct MP4 URL from a video hosting service

// Short built-in WebVTT demo (times may not match the movie dialogue, but demonstrate accuracy)
const DEMO_VTT = `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWelcome! This is a demo subtitle.\n\n00:00:04.500 --> 00:00:07.000\nSubtitles are synced in real time.\n\n00:00:07.500 --> 00:00:10.000\nWorks on iOS, Android, and Web.\n`;

export default function SubtitleVideoPlayer({
  source = DEMO_VIDEO,
  subtitleUrl,
  autoPlay = false,
  controls = true,
  captionFontSize = 18,
  height,
  width = '100%',
}: SubtitleVideoPlayerProps) {
  const videoRef = useRef<Video>(null);
  const [cues, setCues] = useState<VttCue[] | null>(null);
  const [currentText, setCurrentText] = useState<string>('');
  const [isLoadingVtt, setIsLoadingVtt] = useState<boolean>(true);
  const [subsVisible, setSubsVisible] = useState<boolean>(true);
  const [videoSource, setVideoSource] = useState<any>(source);
  const [isPlaying, setIsPlaying] = useState<boolean>(autoPlay);
  const [showPlayButton, setShowPlayButton] = useState<boolean>(!autoPlay);
  const [isLoadingVideo, setIsLoadingVideo] = useState<boolean>(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>(ResizeMode.CONTAIN);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);


  // Load and parse WebVTT
  useEffect(() => {
    let cancelled = false;

    async function loadVtt() {
      try {
        setIsLoadingVtt(true);
        let raw = DEMO_VTT;
        if (subtitleUrl) {
          const res = await fetch(subtitleUrl);
          raw = await res.text();
        }
        if (!cancelled) {
          setCues(parseWebVTT(raw));
        }
      } catch (e) {
        console.warn('Failed to load/parse VTT:', e);
        if (!cancelled) setCues([]);
      } finally {
        if (!cancelled) setIsLoadingVtt(false);
      }
    }

    loadVtt();
    return () => {
      cancelled = true;
    };
  }, [subtitleUrl]);

  // Handle video source changes
  useEffect(() => {
    console.log('Video source changed:', videoSource);
    if (videoSource && videoSource.uri) {
      setIsLoadingVideo(true);
      setIsPlaying(false);
      setShowPlayButton(false);
    }
  }, [videoSource]);

  // Update subtitle when playback position changes
  const onStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      // Update playing state and show/hide play button
      if (status.isLoaded) {
        const isCurrentlyPlaying = status.isPlaying || false;
        setIsPlaying(isCurrentlyPlaying);
        setShowPlayButton(!isCurrentlyPlaying);
        setIsLoadingVideo(false); // Video is loaded, hide loading

        // Update position and duration
        setCurrentPosition(status.positionMillis || 0);
        setDuration(status.durationMillis || 0);

        // Auto-hide controls when playing
        if (isCurrentlyPlaying) {
          resetControlsTimer();
        } else {
          setShowControls(true);
        }
      } else {
        // Video is not loaded yet
        setShowPlayButton(false);
      }

      // Handle subtitles
      if (!status.isLoaded || !cues || cues.length === 0) return;

      const t = status.positionMillis / 1000;
      // binary search could be used; linear is fine for small demo
      const cue = cues.find((c) => t >= c.start && t < c.end);
      if (cue) {
        if (cue.text !== currentText) setCurrentText(cue.text);
      } else {
        if (currentText !== '') setCurrentText('');
      }
    },
    [cues, currentText]
  );

  const caption = useMemo(() => currentText.split(/\n+/g), [currentText]);

  // Create container style based on props
  const containerStyle = useMemo((): ViewStyle => {
    const baseStyle: ViewStyle = {
      width: width as DimensionValue,
    };

    if (height) {
      return { ...baseStyle, height: height as DimensionValue };
    } else {
      return {
        ...baseStyle,
        minHeight: 500,
        maxHeight: 1000,
        aspectRatio: 16/9
      };
    }
  }, [width, height]);

  // Play/Pause video
  const togglePlayPause = async () => {
    if (videoRef.current) {
      try {
        if (isPlaying) {
          console.log('Pausing video');
          await videoRef.current.pauseAsync();
          setIsPlaying(false);
          setShowPlayButton(true);
        } else {
          console.log('Playing video');
          await videoRef.current.playAsync();
          setIsPlaying(true);
          setShowPlayButton(false);
        }
      } catch (error) {
        console.warn('Error toggling play/pause:', error);
      }
    }
  };

  // Toggle resize mode
  const toggleResizeMode = () => {
    const modes = [ResizeMode.CONTAIN, ResizeMode.COVER, ResizeMode.STRETCH];
    const currentIndex = modes.indexOf(resizeMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    setResizeMode(modes[nextIndex]);
  };

  // Get resize mode name for display
  const getResizeModeName = () => {
    switch (resizeMode) {
      case ResizeMode.CONTAIN: return 'Fit All';
      case ResizeMode.COVER: return 'Fill Screen';
      case ResizeMode.STRETCH: return 'Stretch';
      default: return 'Fit All';
    }
  };

  // Toggle mute
  const toggleMute = async () => {
    if (videoRef.current) {
      try {
        if (isMuted) {
          await videoRef.current.setVolumeAsync(volume);
          setIsMuted(false);
        } else {
          await videoRef.current.setVolumeAsync(0);
          setIsMuted(true);
        }
      } catch (error) {
        console.warn('Error toggling mute:', error);
      }
    }
  };

  // Change volume
  const changeVolume = async (newVolume: number) => {
    if (videoRef.current) {
      try {
        await videoRef.current.setVolumeAsync(newVolume);
        setVolume(newVolume);
        setIsMuted(newVolume === 0);
      } catch (error) {
        console.warn('Error changing volume:', error);
      }
    }
  };

  // Toggle fullscreen (for web)
  const toggleFullscreen = () => {
    if (Platform.OS === 'web') {
      if (!isFullscreen) {
        // Enter fullscreen
        const element = document.documentElement;
        if (element.requestFullscreen) {
          element.requestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        setIsFullscreen(false);
      }
    }
  };

  // Seek forward (10 seconds)
  const seekForward = async () => {
    if (videoRef.current && duration > 0) {
      try {
        const newPosition = Math.min(currentPosition + 10000, duration); // 10 seconds in milliseconds
        await videoRef.current.setPositionAsync(newPosition);
        console.log('Seeking forward to:', newPosition / 1000, 'seconds');
      } catch (error) {
        console.warn('Error seeking forward:', error);
      }
    }
  };

  // Seek backward (10 seconds)
  const seekBackward = async () => {
    if (videoRef.current) {
      try {
        const newPosition = Math.max(currentPosition - 10000, 0); // 10 seconds in milliseconds
        await videoRef.current.setPositionAsync(newPosition);
        console.log('Seeking backward to:', newPosition / 1000, 'seconds');
      } catch (error) {
        console.warn('Error seeking backward:', error);
      }
    }
  };

  // Format time for display
  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };



  // Auto-hide controls
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  const resetControlsTimer = () => {
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    setShowControls(true);
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  // Pick local video file (works on web + native)
  const pickVideo = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: true,
      });

      console.log('DocumentPicker result:', result);

      // Handle the result based on the new DocumentPicker API
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const uri = asset.uri;
        console.log('Selected video URI:', uri);

        // Reset states
        setIsLoadingVideo(true);
        setIsPlaying(false);
        setShowPlayButton(false);

        // Update video source
        setVideoSource({ uri });

        console.log('Video source updated to:', { uri });
      } else if ((result as any).uri) {
        // Fallback for older API
        const uri = (result as any).uri;
        console.log('Selected video URI (fallback):', uri);

        setIsLoadingVideo(true);
        setIsPlaying(false);
        setShowPlayButton(false);
        setVideoSource({ uri });
      } else {
        console.log('User cancelled file selection');
      }
    } catch (err) {
      console.warn('pickVideo error:', err);
      setIsLoadingVideo(false);
    }
  };

  return (
    <View>
      {/* Pick button */}
      <View style={{ marginBottom: 10 }}>
        <Pressable style={styles.pickBtn} onPress={pickVideo}>
          <Text style={styles.pickBtnText}>Choose Video File</Text>
        </Pressable>
        {/* Debug info */}
        <Text style={{ color: '#666', fontSize: 12, textAlign: 'center', marginTop: 5 }}>
          Current: {videoSource?.uri ? videoSource.uri.split('/').pop() : 'Demo video'}
        </Text>
      </View>

      {/* Video container */}
      <View style={[styles.container, containerStyle]}>
        <Pressable
          style={styles.videoWrapper}
          onPress={resetControlsTimer}
        >
          <Video
            ref={videoRef}
            source={videoSource}
            useNativeControls={false}
            shouldPlay={false}
            resizeMode={resizeMode}
            volume={isMuted ? 0 : volume}
            onPlaybackStatusUpdate={onStatusUpdate}
            style={styles.video}
            key={videoSource?.uri || 'default'} // Force re-render when source changes
          />



      {/* Play button overlay */}
      {showPlayButton && !isLoadingVideo && (
        <View style={styles.playButtonOverlay}>
          <Pressable style={styles.playButton} onPress={togglePlayPause}>
            <Text style={styles.playButtonText}>▶</Text>
          </Pressable>
        </View>
      )}

      {/* Loading overlay */}
      {isLoadingVideo && (
        <View style={styles.playButtonOverlay}>
          <View style={styles.playButton}>
            <ActivityIndicator size="large" color="#000" />
          </View>
        </View>
      )}

        {/* Subtitles overlay */}
        {subsVisible && (
          <View pointerEvents="none" style={styles.captionsWrap}>
            {isLoadingVtt ? (
              <ActivityIndicator size="small" />
            ) : (
              currentText !== '' && (
                <View style={styles.captionBubble}>
                  {caption.map((line, idx) => (
                    <Text key={idx} style={[styles.captionText, { fontSize: captionFontSize }]}>
                      {line}
                    </Text>
                  ))}
                </View>
              )
            )}
          </View>
        )}

        {/* Overlay controls on video */}
        {showControls && (
          <View style={styles.overlayControls}>
            {/* Top controls */}
            <View style={styles.topControls}>
              <Pressable onPress={toggleResizeMode} style={styles.btn}>
                <Text style={styles.btnText}>{getResizeModeName()}</Text>
              </Pressable>
              <Pressable onPress={() => setSubsVisible((s) => !s)} style={styles.btn}>
                <Text style={styles.btnText}>{subsVisible ? 'Hide Subtitles' : 'Show Subtitles'}</Text>
              </Pressable>
            </View>
          </View>
        )}
        </Pressable>
      </View>

      {/* External Video Controls - Below Video */}
      <View style={styles.externalControls}>
        {/* Backward button */}
        <Pressable style={styles.controlBtn} onPress={seekBackward}>
          <Text style={styles.controlBtnText}>⏪</Text>
        </Pressable>

        {/* Play/Pause button */}
        <Pressable style={styles.controlBtn} onPress={togglePlayPause}>
          <Text style={styles.controlBtnText}>{isPlaying ? '⏸️' : '▶️'}</Text>
        </Pressable>

        {/* Forward button */}
        <Pressable style={styles.controlBtn} onPress={seekForward}>
          <Text style={styles.controlBtnText}>⏩</Text>
        </Pressable>

        {/* Volume button */}
        <Pressable style={styles.controlBtn} onPress={toggleMute}>
          <Text style={styles.controlBtnText}>{isMuted ? '🔇' : '🔊'}</Text>
        </Pressable>

        {/* Volume slider */}
        <View style={styles.volumeSlider}>
          <Pressable
            style={[styles.volumeTrack, { width: 120 }]}
            onPress={(e) => {
              const { locationX } = e.nativeEvent;
              const newVolume = Math.max(0, Math.min(1, locationX / 120));
              changeVolume(newVolume);
            }}
          >
            <View style={[styles.volumeFill, { width: (isMuted ? 0 : volume) * 120 }]} />
          </Pressable>
        </View>

        {/* Fullscreen button */}
        <Pressable style={styles.controlBtn} onPress={toggleFullscreen}>
          <Text style={styles.controlBtnText}>{isFullscreen ? '⛶' : '⛶'}</Text>
        </Pressable>
      </View>

      {/* Time display */}
      <View style={styles.timeDisplay}>
        <Text style={styles.timeText}>
          {formatTime(currentPosition)} / {formatTime(duration)}
        </Text>
      </View>


    </View>
  );
}



const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 12,
    alignSelf: 'center',
    maxWidth: '100%',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  captionsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  captionBubble: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    maxWidth: '92%',
  },
  captionText: {
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    fontWeight: Platform.select({ web: '600' as any, default: '600' }),
  },

  controlsBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  activeBtn: {
    backgroundColor: '#0a84ff',
  },
  listeningIndicator: {
    marginTop: 5,
    alignItems: 'center',
  },
  listeningText: {
    color: '#ff6b6b',
    fontSize: 10,
    fontWeight: 'bold',
  },
  pickBtn: {
    backgroundColor: '#0a84ff',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: 'center',
  },
  pickBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  playButtonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  playButtonText: {
    fontSize: 32,
    color: '#000',
    marginLeft: 4, // Slight offset to center the triangle visually
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  overlayControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-start',
  },
  externalControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 8,
    marginTop: 10,
    gap: 20,
  },
  topControls: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 8,
  },
  controlBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#666',
  },
  controlBtnText: {
    fontSize: 20,
    color: '#fff',
  },
  volumeSlider: {
    flex: 1,
    maxWidth: 150,
    justifyContent: 'center',
  },
  volumeTrack: {
    height: 6,
    backgroundColor: '#666',
    borderRadius: 3,
    position: 'relative',
  },
  volumeFill: {
    height: 6,
    backgroundColor: '#0a84ff',
    borderRadius: 3,
  },
  timeDisplay: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 5,
  },
  timeText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  subtitleContainer: {
    marginTop: 15,
    paddingHorizontal: 10,
    minHeight: 60,
    justifyContent: 'center',
  },
  subtitleLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
  },
  subtitleBox: {
    backgroundColor: '#f8f8f8',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0a84ff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  subtitleText: {
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
  },
  youtubeSubtitleContainer: {
    marginTop: 15,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  youtubeSubtitleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  youtubeSubtitleBox: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 15,
    minHeight: 60,
    justifyContent: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#ff0000',
  },
  youtubeSubtitleText: {
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
  },
  youtubeSubtitlePlaceholder: {
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    fontSize: 14,
  },
});
