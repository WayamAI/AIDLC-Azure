import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const VIDEO_SRC = "/videos/login-hero.mp4";
const REVERSE_FPS = 30;

type LoginVideoContextValue = {
  bindVideo: (el: HTMLVideoElement) => () => void;
  /** One-time fade-in on first paint only never toggled during the loop. */
  ready: boolean;
};

const LoginVideoContext = createContext<LoginVideoContextValue | null>(null);

function useLoginVideo() {
  const ctx = useContext(LoginVideoContext);
  if (!ctx) {
    throw new Error("LoginVideoSurface must be used within LoginVideoProvider");
  }
  return ctx;
}

/** Keeps hero + backdrop videos in sync with a seamless forward / reverse loop. */
export function LoginVideoProvider({ children }: { children: ReactNode }) {
  const videosRef = useRef<Set<HTMLVideoElement>>(new Set());
  const rafRef = useRef<number>();
  const directionRef = useRef<"forward" | "backward">("forward");
  const startedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [videoCount, setVideoCount] = useState(0);

  const getVideos = () => [...videosRef.current];

  const stopReverse = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
  }, []);

  const setAllTime = (time: number) => {
    for (const video of getVideos()) {
      video.currentTime = time;
    }
  };

  const playAll = () => {
    for (const video of getVideos()) {
      void video.play().catch(() => {
        /* Autoplay may be blocked until user interaction */
      });
    }
  };

  const pauseAll = () => {
    for (const video of getVideos()) {
      video.pause();
    }
  };

  const bindVideo = useCallback((el: HTMLVideoElement) => {
    el.muted = true;
    el.playsInline = true;
    el.loop = false;
    el.preload = "auto";
    videosRef.current.add(el);
    setVideoCount(videosRef.current.size);
    return () => {
      videosRef.current.delete(el);
      setVideoCount(videosRef.current.size);
    };
  }, []);

  useEffect(() => {
    if (videoCount < 2) return;
    if (startedRef.current) return;

    const videos = getVideos();
    if (videos.length === 0) return;

    startedRef.current = true;

    const stepReverse = () => {
      const lead = getVideos()[0];
      if (!lead) return;

      const step = 1 / REVERSE_FPS;
      const next = Math.max(0, lead.currentTime - step);

      if (next <= 0.02) {
        directionRef.current = "forward";
        stopReverse();
        setAllTime(0);
        playAll();
        return;
      }

      setAllTime(next);
      rafRef.current = requestAnimationFrame(stepReverse);
    };

    const onTimeUpdate = (e: Event) => {
      const video = e.currentTarget as HTMLVideoElement;
      if (directionRef.current !== "forward") return;

      for (const other of getVideos()) {
        if (other !== video && Math.abs(other.currentTime - video.currentTime) > 0.08) {
          other.currentTime = video.currentTime;
        }
      }
    };

    const onEnded = () => {
      directionRef.current = "backward";
      pauseAll();
      rafRef.current = requestAnimationFrame(stepReverse);
    };

    for (const video of videos) {
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("ended", onEnded);
    }

    const start = () => {
      directionRef.current = "forward";
      setReady(true);
      playAll();
    };

    const allReady = videos.every((v) => v.readyState >= 2);
    if (allReady) {
      start();
    } else {
      let loaded = 0;
      const onLoaded = () => {
        loaded += 1;
        if (loaded >= videos.length) start();
      };
      for (const video of videos) {
        video.addEventListener("loadeddata", onLoaded, { once: true });
      }
    }

    return () => {
      stopReverse();
      startedRef.current = false;
      for (const video of getVideos()) {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
      }
    };
  }, [stopReverse, videoCount]);

  return (
    <LoginVideoContext.Provider value={{ bindVideo, ready }}>
      {children}
    </LoginVideoContext.Provider>
  );
}

type LoginVideoSurfaceProps = {
  className?: string;
  variant?: "hero" | "backdrop";
};

export function LoginVideoSurface({ className, variant = "hero" }: LoginVideoSurfaceProps) {
  const { bindVideo, ready } = useLoginVideo();
  const isBackdrop = variant === "backdrop";
  const videoElRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoElRef.current;
    if (!el) return;
    return bindVideo(el);
  }, [bindVideo]);

  return (
    <video
      ref={videoElRef}
      src={VIDEO_SRC}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:opacity-100",
        isBackdrop
          ? "scale-105 object-cover object-[20%_42%]"
          : "scale-[1.14] object-[20%_42%]",
        /* Fade in once on load; loop never touches opacity again. */
        ready
          ? isBackdrop
            ? "opacity-85 transition-opacity duration-1000 ease-out"
            : "opacity-100 transition-opacity duration-1000 ease-out"
          : "opacity-0",
        className,
      )}
      muted
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}

/** Standalone hero/backdrop video wraps its own provider. Prefer LoginVideoProvider at page level when using multiple surfaces. */
export function LoginHeroVideo(props: LoginVideoSurfaceProps) {
  return (
    <LoginVideoProvider>
      <LoginVideoSurface {...props} />
    </LoginVideoProvider>
  );
}
