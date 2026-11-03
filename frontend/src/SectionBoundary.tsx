import { Component } from 'react';
import type { ReactNode } from 'react';
export default class SectionBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {
    if(this.state.failed)return <section className="section-load-error" role="alert"><h2>This section couldn’t load.</h2><p>Your other tabs are still available. A connection issue or a recent site update may have interrupted loading.</p><button onClick={()=>window.location.reload()}>Reload app</button><small>Reloading clears unsaved selections. Saved research drafts remain in this browser.</small></section>;
    return this.props.children;
  }
}
