import InterfaceIcon from './InterfaceIcon';
import './SiteInfo.css';

export default function SiteFooter({inert}: {inert: boolean}) {
  return <footer className="footer site-footer" inert={inert}>
    <div className="site-footer-main">
      <div className="site-footer-identity">
        <a className="intercepted-footer-brand" href="#dashboard" aria-label="Intercepted dashboard"><img src={`${import.meta.env.BASE_URL}brand/intercepted-logo.svg`} alt="Intercepted"/></a>
        <p className="site-footer-tagline">NFL analytics. More perspective.</p>
        <p className="site-footer-credit">Built by Jackson Fleege.</p>
      </div>
      <nav className="site-footer-links" aria-label="Explore Intercepted">
        <h2>Explore</h2>
        <a href="#matchups">Matchups</a><a href="#players">Players</a><a href="#performance">Performance</a><a href="#markets">Markets</a>
      </nav>
      <nav className="site-footer-links" aria-label="About Intercepted">
        <h2>Behind the numbers</h2>
        <a href="#methodology">Models &amp; data sources</a>
        <button type="button" aria-haspopup="dialog" onClick={event => {
          event.currentTarget.focus({ preventScroll: true });
          document.getElementById('refresh-status')?.click();
        }}>Data status</button>
        <a href="https://github.com/jfleege/intercepted/issues/new" target="_blank" rel="noreferrer">Report an issue <span className="sr-only">(opens GitHub in a new tab)</span><InterfaceIcon name="external" /></a>
      </nav>
    </div>
    <div className="site-footer-bottom">
      <div className="site-footer-legal"><span>© {new Date().getFullYear()} Intercepted. All rights reserved.</span><nav aria-label="Legal"><a href="#privacy">Privacy</a><a href="#terms">Terms</a></nav></div>
      <p>Predictions are statistical estimates, not guarantees. Inputs and projected quarterbacks may change before kickoff.</p>
      <p>Independent project. Not affiliated with the NFL, its teams, or DraftKings. Third-party names, logos, images, and data belong to their respective owners.</p>
    </div>
  </footer>;
}
