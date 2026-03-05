import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';
import './CollaborativeEditor.css';

const CollaborativeEditor = () => {
  const [socket, setSocket] = useState(null);
  const [documentId, setDocumentId] = useState('default-doc');
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [code, setCode] = useState('');
  const [users, setUsers] = useState([]);
  const [cursors, setCursors] = useState({});
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [language, setLanguage] = useState('javascript');
  const [showOutput, setShowOutput] = useState(false);
  
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const isRemoteChangeRef = useRef(false);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io('http://localhost:4000');
    setSocket(newSocket);

    return () => newSocket.close();
  }, []);

  // Setup socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('load-document', ({ content, users: docUsers }) => {
      setCode(content);
      setUsers(docUsers);
      console.log('Document loaded');
    });

    socket.on('receive-changes', ({ content }) => {
      isRemoteChangeRef.current = true;
      setCode(content);
    });

    socket.on('user-joined', (user) => {
      setUsers(prev => [...prev, user]);
      addSystemMessage(`${user.username} joined the session`);
    });

    socket.on('user-left', (userId) => {
      const user = users.find(u => u.id === userId);
      if (user) {
        addSystemMessage(`${user.username} left the session`);
      }
      setUsers(prev => prev.filter(u => u.id !== userId));
      setCursors(prev => {
        const newCursors = { ...prev };
        delete newCursors[userId];
        return newCursors;
      });
    });

    socket.on('cursor-moved', ({ userId, username, color, position }) => {
      setCursors(prev => ({
        ...prev,
        [userId]: { username, color, position }
      }));
    });

    socket.on('execution-result', ({ success, output: execOutput }) => {
      setIsRunning(false);
      setOutput(prevOutput => {
        const timestamp = new Date().toLocaleTimeString();
        const status = success ? '✓' : '✗';
        return prevOutput + `\n[${timestamp}] ${status} Execution ${success ? 'completed' : 'failed'}:\n${execOutput}\n${'='.repeat(60)}\n`;
      });
      setShowOutput(true);
    });

    return () => {
      socket.off('load-document');
      socket.off('receive-changes');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('cursor-moved');
      socket.off('execution-result');
    };
  }, [socket, users]);

  // Update cursor decorations
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const decorations = Object.entries(cursors).map(([userId, cursor]) => ({
      range: new monacoRef.current.Range(
        cursor.position.lineNumber,
        cursor.position.column,
        cursor.position.lineNumber,
        cursor.position.column
      ),
      options: {
        className: 'remote-cursor',
        beforeContentClassName: 'remote-cursor-label',
      }
    }));

    decorationsRef.current = editorRef.current.deltaDecorations(
      decorationsRef.current,
      decorations
    );
  }, [cursors]);

  const addSystemMessage = (message) => {
    setOutput(prev => {
      const timestamp = new Date().toLocaleTimeString();
      return prev + `[${timestamp}] ℹ ${message}\n`;
    });
  };

  const joinDocument = () => {
    if (!username.trim() || !documentId.trim()) return;
    
    socket.emit('join-document', { 
      documentId, 
      username: username.trim() 
    });
    setIsJoined(true);
  };

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Track cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      if (socket && isJoined) {
        socket.emit('cursor-update', {
          documentId,
          position: e.position
        });
      }
    });
  };

  const handleEditorChange = (value) => {
    if (!socket || !isJoined) return;

    // If this is a remote change, don't send it back
    if (isRemoteChangeRef.current) {
      isRemoteChangeRef.current = false;
      return;
    }

    setCode(value);
    
    // Send changes to server
    socket.emit('send-changes', {
      documentId,
      content: value
    });
  };

  const runCode = () => {
    if (!code.trim()) {
      setOutput(prev => prev + '\n[Error] No code to execute\n');
      return;
    }

    setIsRunning(true);
    setShowOutput(true);
    
    const timestamp = new Date().toLocaleTimeString();
    setOutput(prev => prev + `\n[${timestamp}] ▶ Running ${language} code...\n`);

    if (language === 'python' || language === 'javascript') {
      // Send to server for execution
      socket.emit('execute-code', {
        code: code,
        language: language
      });
    } else if (language === 'html') {
      setIsRunning(false);
      setOutput(prev => prev + `\n[${timestamp}] ✓ HTML preview rendered\n${'='.repeat(60)}\n`);
    } else {
      setIsRunning(false);
      setOutput(prev => prev + `\n[${timestamp}] ✗ Language '${language}' execution not supported yet\n${'='.repeat(60)}\n`);
    }
  };

  const clearOutput = () => {
    setOutput('');
  };

  const downloadCode = () => {
  // Determine file extension based on language
  const extensions = {
    javascript: 'js',
    python: 'py',
    html: 'html',
    css: 'css',
    java: 'java',
    cpp: 'cpp',
    typescript: 'ts',
    c: 'c',
  };
  
  const extension = extensions[language] || 'txt';
  const fileName = `${documentId}.${extension}`;
  
  // Create a blob from the code
  const blob = new Blob([code], { type: 'text/plain' });
  
  // Create a temporary download link
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  
  // Add to output console
  const timestamp = new Date().toLocaleTimeString();
  setOutput(prev => prev + `\n[${timestamp}] ⬇️ Downloaded ${fileName}\n`);
};

  const toggleOutput = () => {
    setShowOutput(!showOutput);
  };

  if (!isJoined) {
    return (
      <div className="join-container">
        <div className="join-card">
          <h2>Join Collaborative Session</h2>
          <input
            type="text"
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && joinDocument()}
          />
          <input
            type="text"
            placeholder="Document ID"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && joinDocument()}
          />
          <button onClick={joinDocument}>Join</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-container">
      <div className="header">
        <div className="header-left">
          <h3>Collaborative Code Editor - {documentId}</h3>
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value)}
            className="language-selector"
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
          </select>
        </div>
        <div className="header-right">
          <div className="users-list">
            <span>Active users: </span>
            {users.map(user => (
              <span 
                key={user.id} 
                className="user-badge"
                style={{ backgroundColor: user.color }}
              >
                {user.username}
              </span>
            ))}
          </div>
          <button 
            onClick={runCode} 
            className="run-button"
            disabled={isRunning}
          >
            {isRunning ? '⏳ Running...' : '▶ Run Code'}
          </button>
          <button 
            onClick={downloadCode} 
            className="download-button"
            disabled={!code.trim()}
          >
          ⬇️ Download
          </button>
          <button 
            onClick={toggleOutput} 
            className={`toggle-output-button ${showOutput ? 'active' : ''}`}
          >
            {showOutput ? '📋 Hide Output' : '📋 Show Output'}
          </button>
          <button 
            onClick={clearOutput} 
            className="clear-button"
            disabled={!output}
          >
            🗑️ Clear
          </button>
        </div>
      </div>
      
      <div className="editor-wrapper">
        <div className={`editor-panel ${showOutput ? 'with-output' : 'full-width'}`}>
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              automaticLayout: true,
            }}
          />
        </div>
        
        {showOutput && (
          <div className="output-panel">
            <div className="output-header">
              <span>📟 Output Console</span>
              <button onClick={clearOutput} className="clear-output-btn">Clear</button>
            </div>
            <pre className="output-content">{output || 'No output yet. Run your code to see results here.'}</pre>
            {language === 'html' && code.trim() && (
              <div className="html-preview">
                <div className="preview-header">🌐 HTML Preview</div>
                <iframe
                  srcDoc={code}
                  title="HTML Preview"
                  sandbox="allow-scripts"
                  className="preview-frame"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollaborativeEditor;