const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { PythonShell } = require('python-shell');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store active documents and users
const documents = new Map();
const users = new Map();

// Create temp directory for code execution
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle user joining a document
  socket.on('join-document', ({ documentId, username }) => {
    socket.join(documentId);
    
    // Store user info
    users.set(socket.id, {
      id: socket.id,
      username: username || `User-${socket.id.slice(0, 4)}`,
      documentId,
      color: getRandomColor()
    });

    // Initialize document if it doesn't exist
    if (!documents.has(documentId)) {
      documents.set(documentId, {
        content: '// Start coding together!\n',
        users: new Set()
      });
    }

    const doc = documents.get(documentId);
    doc.users.add(socket.id);

    // Send current document state to the new user
    socket.emit('load-document', {
      content: doc.content,
      users: Array.from(doc.users).map(id => users.get(id))
    });

    // Notify others that a new user joined
    socket.to(documentId).emit('user-joined', users.get(socket.id));

    console.log(`${users.get(socket.id).username} joined document ${documentId}`);
  });

  // Handle code changes
  socket.on('send-changes', ({ documentId, content }) => {
    console.log(`Received changes for ${documentId}`);
    
    const doc = documents.get(documentId);
    if (doc) {
      doc.content = content;
      
      // Broadcast changes to all other users in the document
      socket.to(documentId).emit('receive-changes', {
        content: content,
        userId: socket.id
      });
    }
  });

  // Handle code execution
  socket.on('execute-code', async ({ code, language }) => {
    console.log(`Executing ${language} code for ${socket.id}`);
    
    try {
      let output = '';
      
      if (language === 'python') {
        output = await executePython(code, socket.id);
      } else if (language === 'javascript') {
        output = await executeJavaScript(code);
      } else {
        output = `Language '${language}' execution not supported on server yet.`;
      }
      
      socket.emit('execution-result', {
        success: true,
        output: output
      });
    } catch (error) {
      socket.emit('execution-result', {
        success: false,
        output: `Error: ${error.message}\n${error.stack || ''}`
      });
    }
  });

  // Handle cursor position updates
  socket.on('cursor-update', ({ documentId, position }) => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(documentId).emit('cursor-moved', {
        userId: socket.id,
        username: user.username,
        color: user.color,
        position
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const doc = documents.get(user.documentId);
      if (doc) {
        doc.users.delete(socket.id);
        socket.to(user.documentId).emit('user-left', socket.id);
      }
      
      // Clean up temp files for this user
      cleanupTempFiles(socket.id);
      
      users.delete(socket.id);
      console.log(`${user.username} disconnected`);
    }
  });
});

// Execute Python code
async function executePython(code, userId) {
  return new Promise((resolve, reject) => {
    const fileName = `${userId}_${Date.now()}.py`;
    const filePath = path.join(tempDir, fileName);
    
    // Write code to temp file
    fs.writeFileSync(filePath, code);
    
    const options = {
      mode: 'text',
      pythonPath: 'python', // Use 'python3' on Mac/Linux if needed
      pythonOptions: ['-u'], // unbuffered output
      scriptPath: tempDir,
      args: []
    };
    
    let output = '';
    let errorOutput = '';
    
    const pyshell = new PythonShell(fileName, options);
    
    // Collect stdout
    pyshell.on('message', (message) => {
      output += message + '\n';
    });
    
    // Collect stderr
    pyshell.on('stderr', (stderr) => {
      errorOutput += stderr + '\n';
    });
    
    // Handle completion
    pyshell.end((err) => {
      // Clean up temp file
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error deleting temp file:', e);
      }
      
      if (err) {
        reject(new Error(errorOutput || err.message));
      } else {
        resolve(output || errorOutput || 'Code executed successfully (no output)');
      }
    });
    
    // Set timeout (10 seconds)
    setTimeout(() => {
      pyshell.kill();
      reject(new Error('Execution timeout (10 seconds)'));
    }, 10000);
  });
}

// Execute JavaScript code (Node.js)
async function executeJavaScript(code) {
  return new Promise((resolve, reject) => {
    try {
      const logs = [];
      const customConsole = {
        log: (...args) => logs.push(args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ')),
        error: (...args) => logs.push('ERROR: ' + args.join(' ')),
        warn: (...args) => logs.push('WARNING: ' + args.join(' ')),
        info: (...args) => logs.push('INFO: ' + args.join(' ')),
      };
      
      // Execute code with custom console
      const func = new Function('console', code);
      func(customConsole);
      
      resolve(logs.length > 0 ? logs.join('\n') : 'Code executed successfully (no output)');
    } catch (error) {
      reject(error);
    }
  });
}

// Clean up temp files for a user
function cleanupTempFiles(userId) {
  try {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
      if (file.startsWith(userId)) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    });
  } catch (error) {
    console.error('Error cleaning up temp files:', error);
  }
}

function getRandomColor() {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});