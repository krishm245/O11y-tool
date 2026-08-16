function App() {
  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="O11y Replay home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          O11y Replay
        </a>
        <span className="prototype-label">Local prototype</span>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Recording library</p>
        <h1 id="page-title">See what happened. Fix what matters.</h1>
        <p className="hero-copy">
          Session recordings will appear here after they are captured by the
          browser extension and stored by the local service.
        </p>
      </section>

      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-illustration" aria-hidden="true">
          <span className="play-symbol" />
          <span className="timeline-line" />
          <span className="timeline-dot timeline-dot--one" />
          <span className="timeline-dot timeline-dot--two" />
        </div>
        <p className="status-pill">
          <span /> Web app ready
        </p>
        <h2 id="empty-title">No recordings yet</h2>
      </section>
    </main>
  );
}

export default App;
