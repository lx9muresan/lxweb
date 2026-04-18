/* global React, ReactDOM */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ---- Tweak defaults (persisted by host) ----
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layoutSeed": 7
}/*EDITMODE-END*/;

// ---- Drift animation: per-photo subtle floating offset ----
// We give each photo a unique phase + frequency so motion feels organic.
function useDrifts(count, seed) {
  return useMemo(() => {
    const rng = window.Layouts.makeRng(seed * 1000 + count);
    return Array.from({ length: count }, () => ({
      ax: 0.4 + rng() * 0.9,           // amplitude x (%)
      ay: 0.4 + rng() * 0.9,           // amplitude y (%)
      px: rng() * Math.PI * 2,         // phase x
      py: rng() * Math.PI * 2,         // phase y
      fx: 0.00018 + rng() * 0.00018,   // freq x (rad/ms)
      fy: 0.00018 + rng() * 0.00018,   // freq y
      ar: 0.3 + rng() * 0.5,           // rotation wobble amplitude (deg)
      pr: rng() * Math.PI * 2,
      fr: 0.00012 + rng() * 0.00015,
    }));
  }, [count, seed]);
}

// ---- Animation frame hook: returns current time (ms) ----
function useClock() {
  const [t, setT] = useState(() => performance.now());
  useEffect(() => {
    let raf;
    const loop = () => { setT(performance.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

// =====================================================
// Photo tile — positioned absolutely, drifts gently
// =====================================================
function PhotoTile({ photo, layout, drift, t, onClick, dim }) {
  const [loaded, setLoaded] = useState(false);
  if (!layout) return null;

  const style = {
    position: 'absolute',
    left: `${layout.x}%`,
    top: `${layout.y}%`,
    width: `${layout.w}%`,
    height: `${layout.h}%`,
    transform: `rotate(${layout.rot}deg)`,
    transition: 'filter 500ms ease, opacity 500ms ease',
    filter: dim ? 'saturate(0.7) brightness(0.95)' : 'none',
    opacity: dim ? 0.5 : 1,
    cursor: 'pointer',
    zIndex: layout.z ?? 1,
  };

  return (
    <div
      className="tile"
      style={style}
      onClick={() => onClick(photo)}
    >
      <div className="tile-inner">
        {!loaded && <div className="tile-skeleton" />}
        <img
          src={photo.thumb}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      </div>
    </div>
  );
}

// =====================================================
// Cluster label (collections page)
// =====================================================
function ClusterLabel({ label, visible }) {
  const align = label.align || 'center';
  return (
    <div
      className="cluster-label"
      style={{
        position: 'absolute',
        left: `${label.x}%`,
        top: `${label.y}%`,
        transform: align === 'center' ? 'translate(-50%, 0)' : 'translate(0, 0)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 600ms ease 200ms',
      }}
    >
      {label.name}
    </div>
  );
}

// =====================================================
// Carousel — fullscreen minimal; click edges to advance
// =====================================================
function Carousel({ photos, startIndex, onClose }) {
  const [i, setI] = useState(startIndex);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setLoaded(false); }, [i]);

  const prev = useCallback(() => setI(v => (v - 1 + photos.length) % photos.length), [photos.length]);
  const next = useCallback(() => setI(v => (v + 1) % photos.length), [photos.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  const photo = photos[i];

  return (
    <div className="carousel" role="dialog" aria-modal="true">
      <div className="carousel-stage">
        {!loaded && <div className="carousel-skeleton" />}
        <img
          key={photo.id}
          src={photo.src}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      </div>
      <button className="edge edge-left"  onClick={prev} aria-label="Previous" />
      <button className="edge edge-right" onClick={next} aria-label="Next" />
      <button className="carousel-close" onClick={onClose} aria-label="Close">close</button>
      <div className="carousel-counter">{String(i + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</div>
    </div>
  );
}

// =====================================================
// About panel (home page only)
// =====================================================
function AboutPanel({ bio }) {
  return (
    <div className="about-panel">
      <p>{bio}</p>
    </div>
  );
}

// =====================================================
// Tweaks panel
// =====================================================
function TweaksPanel({ visible, onRandomize, seed }) {
  if (!visible) return null;
  return (
    <div className="tweaks-panel">
      <div className="tweaks-title">Tweaks</div>
      <div className="tweaks-row">
        <span className="tweaks-label">layout</span>
        <button className="tweaks-btn" onClick={onRandomize}>randomize</button>
      </div>
      <div className="tweaks-row">
        <span className="tweaks-label">seed</span>
        <span className="tweaks-value">{seed}</span>
      </div>
    </div>
  );
}

// =====================================================
// Main App
// =====================================================
const BIO = "hi, I'm lx. i'm that kind of person who is reluctant to share their work with the world for some reason. this is a space I created for my photography to exist online. this will probably evolve and change over time. take some time to explore, i hope you enjoy <3";

function App() {
  const [view, setView] = useState('home'); // 'home' | 'collections' | 'about'
  const [seed, setSeed] = useState(TWEAK_DEFAULTS.layoutSeed);
  const [carouselIdx, setCarouselIdx] = useState(null);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [displayView, setDisplayView] = useState('home');

  const photos = window.PHOTOS || [];
  const t = 0;
  const drifts = useMemo(() => photos.map(() => ({})), [photos]);
  const isEmpty = photos.length === 0;

  // Track viewport size for responsive layouts
  const [vp, setVp] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1600,
    vh: typeof window !== 'undefined' ? window.innerHeight : 1000,
  }));
  useEffect(() => {
    const onResize = () => setVp({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const isMobile = vp.vw / vp.vh < 0.9;

  // Compute both layouts
  const homeLayout = useMemo(
    () => window.Layouts.scatteredLayout(photos, seed, { vw: vp.vw, vh: vp.vh }),
    [photos, seed, vp.vw, vp.vh]
  );
  const collectionsLayout = useMemo(
    () => window.Layouts.groupedLayout(photos, seed + 1, { vw: vp.vw, vh: vp.vh }),
    [photos, seed, vp.vw, vp.vh]
  );

  // Crossfade between views
  useEffect(() => {
    if (view === displayView) return;
    setFading(true);
    const t1 = setTimeout(() => {
      setDisplayView(view);
      const t2 = setTimeout(() => setFading(false), 20);
      return () => clearTimeout(t2);
    }, 320);
    return () => clearTimeout(t1);
  }, [view, displayView]);

  // Edit-mode protocol
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode') setTweaksVisible(true);
      else if (d.type === '__deactivate_edit_mode') setTweaksVisible(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const randomize = () => {
    const s = Math.floor(Math.random() * 9999) + 1;
    setSeed(s);
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits: { layoutSeed: s },
    }, '*');
  };

  const openCarousel = (photo) => {
    setCarouselIdx(photo.index);
  };

  const closeCarousel = () => setCarouselIdx(null);

  // Which layout to render based on displayView
  const isCollections = displayView === 'collections';
  const isAbout = displayView === 'about';
  const layouts = isCollections ? collectionsLayout.items : homeLayout;
  const labels = isCollections ? collectionsLayout.labels : [];

  return (
    <div className={`app ${isMobile ? 'is-mobile' : ''}`}>
      {/* Nav */}
      <nav className="nav" data-screen-label="nav">
        <button
          className={`nav-item nav-brand ${view === 'home' ? 'active' : ''}`}
          onClick={() => setView('home')}
        >
          lxmuresan
        </button>
        <button
          className={`nav-item ${view === 'collections' ? 'active' : ''}`}
          onClick={() => setView('collections')}
        >
          collections
        </button>
        <button
          className={`nav-item ${view === 'about' ? 'active' : ''}`}
          onClick={() => setView('about')}
        >
          about
        </button>
      </nav>

      {/* Stage */}
      <div
        className="stage"
        data-screen-label={displayView}
        style={{
          opacity: fading ? 0 : 1,
          transition: 'opacity 320ms ease',
        }}
      >
        {/* Home bio blurb — short teaser (desktop only; mobile gets it on about page) */}
        {displayView === 'home' && !isMobile && (
          <AboutPanel bio={"photography, collected slowly."} />
        )}

        {/* Empty state — no photos yet */}
        {!isAbout && isEmpty && (
          <div className="empty-state">
            <p>no photos yet.</p>
            <p className="empty-hint">drop images into <code>photos/&lt;collection&gt;/</code> and run <code>npm run build</code>.</p>
          </div>
        )}

        {/* Photos (home + collections) */}
        {!isAbout && !isEmpty && photos.map((p, i) => (
          <PhotoTile
            key={p.id}
            photo={p}
            layout={layouts[i]}
            drift={drifts[i]}
            t={t}
            onClick={openCarousel}
          />
        ))}

        {/* Cluster labels (collections only) */}
        {isCollections && labels.map(l => (
          <ClusterLabel key={l.id} label={l} visible={!fading} />
        ))}

        {/* About page */}
        {isAbout && (
          <div className="about-page">
            <p>{BIO}</p>
          </div>
        )}
      </div>

      {/* Carousel overlay */}
      {carouselIdx !== null && (
        <Carousel
          photos={photos}
          startIndex={carouselIdx}
          onClose={closeCarousel}
        />
      )}

      <TweaksPanel
        visible={tweaksVisible}
        onRandomize={randomize}
        seed={seed}
      />
    </div>
  );
}

function mount() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
}
if (window.__dataReady) {
  mount();
} else {
  window.addEventListener('data-ready', mount, { once: true });
}
