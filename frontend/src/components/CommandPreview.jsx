import React from 'react';

export default function CommandPreview({ lines }) {
  return (
    <div className="form-group">
      <label className="form-label">Comando a ejecutar:</label>
      <pre className="command-preview">
        {lines.join('\n')}
      </pre>
    </div>
  );
}
