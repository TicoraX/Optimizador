import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-color, #ddd)' }}>
          <h2>Algo sali&oacute; mal</h2>
          <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: '1.5rem' }}>
            {this.state.error?.message || 'Error inesperado en la interfaz'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              padding: '0.5rem 1.5rem', border: 'none', borderRadius: '6px',
              background: 'var(--accent-color, #7c5cfc)', color: '#fff',
              cursor: 'pointer', fontSize: '0.9rem',
            }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}