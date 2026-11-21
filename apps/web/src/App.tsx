const suits = [
  { rank: "A", suit: "♠", color: "black" },
  { rank: "K", suit: "♥", color: "red" },
  { rank: "Q", suit: "♠", color: "black" },
  { rank: "J", suit: "♦", color: "red" },
  { rank: "10", suit: "♣", color: "black" },
];

function App() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <a aria-label="Perfect Draw home" className="brand" href="/">
          <span aria-hidden="true" className="brand-mark">P</span>
          <span>PERFECT DRAW</span>
        </a>
        <span className="local-badge">
          <span aria-hidden="true" className="status-dot" />
          LOCAL TRAINING
        </span>
      </header>

      <section aria-labelledby="welcome-title" className="welcome">
        <div className="welcome-copy">
          <p className="eyebrow">THE VIDEO POKER TRAINER</p>
          <h1 id="welcome-title">
            Make every
            <br />
            <span>decision count.</span>
          </h1>
          <p className="intro">
            Learn the play behind every hand. Practice with precise,
            engine-checked strategy and build toward your next casino trip.
          </p>
          <button className="start-button" disabled type="button">
            Start training <span aria-hidden="true">↗</span>
          </button>
          <p className="coming-soon">Your training table is being prepared.</p>
        </div>

        <div aria-label="Sample poker hand preview" className="table-card">
          <div className="table-topline">
            <span>JACKS OR BETTER</span>
            <span className="table-status"><span /> READY SOON</span>
          </div>
          <div className="cards" aria-hidden="true">
            {suits.map((card, index) => (
              <div className={`playing-card ${card.color}`} key={`${card.rank}-${card.suit}`}>
                <span className="card-index">0{index + 1}</span>
                <span className="card-rank">{card.rank}</span>
                <span className="card-suit">{card.suit}</span>
              </div>
            ))}
          </div>
          <div className="table-footer">
            <span>EXACT STRATEGY</span>
            <span>ALWAYS IN YOUR HAND</span>
          </div>
        </div>
      </section>

      <section aria-label="Product principles" className="principles">
        <article>
          <span className="principle-number">01</span>
          <div>
            <h2>Know the right play</h2>
            <p>Decisions guided by exact, deterministic math.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">02</span>
          <div>
            <h2>Practice your way</h2>
            <p>Your sessions and progress stay on your device.</p>
          </div>
        </article>
        <article>
          <span className="principle-number">03</span>
          <div>
            <h2>Build lasting skill</h2>
            <p>Focused training for the decisions that matter.</p>
          </div>
        </article>
      </section>

      <footer className="page-footer">
        <span>PLAY SMARTER, ONE HAND AT A TIME.</span>
        <span>PLAY MONEY ONLY · NO ACCOUNT REQUIRED</span>
      </footer>
    </main>
  );
}

export default App;
