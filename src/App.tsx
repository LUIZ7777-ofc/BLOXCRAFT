import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { 
  Box as BoxIcon, 
  MessageSquare, 
  Settings, 
  LogOut, 
  Users, 
  Play, 
  Plus, 
  Image as ImageIcon,
  Code,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Types
type User = {
  id: string;
  username: string;
  password?: string;
  isAdmin: boolean;
  isBanned: boolean;
  joinedAt: number;
  friends: string[];
};

type Game = {
  id: string;
  name: string;
  tree: Record<string, TreeNode>;
  lastModified: number;
  ownerId?: string;
};

type View = 'lobby' | 'editor';

// 2D Studio Types
type GameObject = { type?: 'rect' | 'text', text?: string, font?: string, x: number, y: number, color: string, w?: number, h?: number };
type TreeNode = {
  name: string;
  icon: string;
  type?: 'script' | 'folder';
  content?: string;
  children?: TreeNode[];
};

const initialGameTree: Record<string, TreeNode> = {
  Workspace: { name: "Workspace", icon: "🌍", children: [
      { name: "Baseplate", icon: "📜", type: "script", content: `// Baseplate Script
const baseplate = game.createPart(0, 0, '#2d2d2d', 10000, 50);

game.onUpdate(() => {
  baseplate.y = game.getCanvasHeight() - 50;
  baseplate.w = game.getCanvasWidth();
});` },
      { name: "CoinSpawner", icon: "📜", type: "script", content: `// Coin Spawner & Score
let score = 0;
const scoreText = game.createText('Score: 0', 20, 40, '#ffffff', 'bold 24px sans-serif');
const coins = [];

// Spawn a coin every 2 seconds
let timer = 0;
game.onUpdate((dt) => {
  timer += dt;
  if (timer > 2) {
    timer = 0;
    const x = Math.random() * (game.getCanvasWidth() - 30);
    const y = Math.random() * (game.getCanvasHeight() - 100);
    const coin = game.createPart(x, y, '#fbbf24', 30, 30);
    coins.push(coin);
  }
});

// Expose coins and score to global game object so player can interact
game.state = { coins, score, scoreText };
` }
  ]},
  StarterPlayer: { name: "StarterPlayer", icon: "👤", children: [
      { name: "StarterPlayerScripts", icon: "📁", children: [
          { name: "PlayerMovement", icon: "📜", type: "script", content: `// Player Movement & Collision Script
const player = game.createPart(100, 100, '#3b82f6', 40, 40);
const normalSpeed = 300;
const sprintSpeed = 600;

game.onUpdate((dt) => {
  const keys = game.getKeys();
  const speed = keys['Shift'] ? sprintSpeed : normalSpeed;
  
  if (keys['ArrowUp'] || keys['w']) player.y -= speed * dt;
  if (keys['ArrowDown'] || keys['s']) player.y += speed * dt;
  if (keys['ArrowLeft'] || keys['a']) player.x -= speed * dt;
  if (keys['ArrowRight'] || keys['d']) player.x += speed * dt;
  
  // Keep in bounds
  if (player.x < 0) player.x = 0;
  if (player.y < 0) player.y = 0;
  if (player.x > game.getCanvasWidth() - player.w) player.x = game.getCanvasWidth() - player.w;
  if (player.y > game.getCanvasHeight() - player.h) player.y = game.getCanvasHeight() - player.h;

  // Check collision with coins
  if (game.state && game.state.coins) {
    for (let i = game.state.coins.length - 1; i >= 0; i--) {
      const coin = game.state.coins[i];
      if (
        player.x < coin.x + coin.w &&
        player.x + player.w > coin.x &&
        player.y < coin.y + coin.h &&
        player.y + player.h > coin.y
      ) {
        // Collision detected!
        game.destroyPart(coin);
        game.state.coins.splice(i, 1);
        game.state.score += 10;
        game.state.scoreText.text = 'Score: ' + game.state.score;
      }
    }
  }
});` }
      ]}
  ]}
};

export default function App() {
  const [view, setView] = useState<View | 'auth'>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [adminCommand, setAdminCommand] = useState('');
  const [bannedUserIds, setBannedUserIds] = useState<string[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [publicGames, setPublicGames] = useState<Game[]>([]);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [friendUsername, setFriendUsername] = useState('');

  // 2D Studio State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameObjects, setGameObjects] = useState<GameObject[]>([]);
  const [gameTree, setGameTree] = useState(initialGameTree);
  const [activeScript, setActiveScript] = useState<TreeNode | null>(null);
  const [scriptContent, setScriptContent] = useState('');
  const [isScriptOpen, setIsScriptOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showExplorer, setShowExplorer] = useState(window.innerWidth >= 768);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayOnlyMode, setIsPlayOnlyMode] = useState(false);
  const engineRef = useRef<{ stop: () => void } | null>(null);

  // Load users and banned list from localStorage
  useEffect(() => {
    const savedUsers = localStorage.getItem('bloxcraft_users');
    const savedBanned = localStorage.getItem('bloxcraft_banned');
    const savedGames = localStorage.getItem('bloxcraft-games');
    const savedGlobalMsg = localStorage.getItem('bloxcraft_global_msg');
    const savedUserId = localStorage.getItem('bloxcraft_current_user');
    
    let loadedUsers: User[] = [];
    if (savedUsers) {
      loadedUsers = JSON.parse(savedUsers);
      setAllUsers(loadedUsers);
    }
    
    if (savedBanned) setBannedUserIds(JSON.parse(savedBanned));
    if (savedGames) setGames(JSON.parse(savedGames));
    if (savedGlobalMsg) setGlobalMessage(savedGlobalMsg);

    if (savedUserId && loadedUsers.length > 0) {
      const currentUser = loadedUsers.find(u => u.id === savedUserId);
      if (currentUser && !JSON.parse(savedBanned || '[]').includes(currentUser.id)) {
        setUser(currentUser);
        setView('lobby');
      }
    }
  }, []);

  // Save users and banned list to localStorage
  useEffect(() => {
    localStorage.setItem('bloxcraft_users', JSON.stringify(allUsers));
    if (user) {
      const updatedUser = allUsers.find(u => u.id === user.id);
      if (updatedUser) {
        setUser(updatedUser);
        localStorage.setItem('bloxcraft_current_user', updatedUser.id);
      }
    } else {
      localStorage.removeItem('bloxcraft_current_user');
    }
  }, [allUsers, user]);

  useEffect(() => {
    localStorage.setItem('bloxcraft_banned', JSON.stringify(bannedUserIds));
  }, [bannedUserIds]);

  useEffect(() => {
    if (globalMessage) {
      localStorage.setItem('bloxcraft_global_msg', globalMessage);
    } else {
      localStorage.removeItem('bloxcraft_global_msg');
    }
  }, [globalMessage]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      localStorage.setItem('bloxcraft-games', JSON.stringify(games));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [games]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim() || !authPassword.trim()) return;

    const existingUser = allUsers.find(u => u.username.toLowerCase() === authUsername.toLowerCase());

    if (authMode === 'login') {
      if (existingUser) {
        if (!existingUser.password && authPassword) {
          const updatedUser = { ...existingUser, password: authPassword };
          setAllUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
          setUser(updatedUser);
          setView('lobby');
          return;
        }
        if (existingUser.password && existingUser.password !== authPassword) {
          alert('Incorrect password.');
          return;
        }
        if (bannedUserIds.includes(existingUser.id)) {
          alert('You are banned from this experience.');
          return;
        }
        setUser(existingUser);
        setView('lobby');
      } else {
        alert('User not found. Please sign up.');
      }
    } else {
      if (existingUser) {
        alert('Username already taken.');
      } else {
        const newUser: User = {
          id: Math.random().toString(36).substr(2, 9),
          username: authUsername,
          password: authPassword,
          isAdmin: authUsername === 'laikinhomiproooooo',
          isBanned: false,
          joinedAt: Date.now(),
          friends: []
        };
        setAllUsers([...allUsers, newUser]);
        setUser(newUser);
        setView('lobby');
      }
    }
  };

  const banUser = (userId: string) => {
    if (userId === user?.id) return alert("You can't ban yourself!");
    setBannedUserIds(prev => [...prev, userId]);
  };

  const unbanUser = (userId: string) => {
    setBannedUserIds(prev => prev.filter(id => id !== userId));
  };

  const handleAdminCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const parts = adminCommand.trim().split(' ');
    if (parts.length < 2) return;
    
    const action = parts[0].toLowerCase();
    
    if (action === 'global') {
      const msg = parts.slice(1).join(' ');
      setGlobalMessage(msg);
      setAdminCommand('');
      return;
    }

    const targetUsername = parts.slice(1).join(' ');
    const targetUser = allUsers.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
    
    if (!targetUser) {
      alert(`User "${targetUsername}" not found.`);
      return;
    }
    
    if (action === 'ban') {
      banUser(targetUser.id);
      setAdminCommand('');
    } else if (action === 'unban') {
      unbanUser(targetUser.id);
      setAdminCommand('');
    } else {
      alert('Unknown command. Use "ban <username>", "unban <username>", or "global <message>".');
    }
  };

  const addFriend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !friendUsername.trim()) return;

    const targetUser = allUsers.find(u => u.username.toLowerCase() === friendUsername.toLowerCase());
    
    if (!targetUser) {
      alert(`User "${friendUsername}" not found.`);
      return;
    }

    if (targetUser.id === user.id) {
      alert("You can't add yourself as a friend!");
      return;
    }

    if (user.friends.includes(targetUser.id)) {
      alert("You are already friends with this user.");
      return;
    }

    setAllUsers(prev => prev.map(u => {
      if (u.id === user.id) {
        return { ...u, friends: [...u.friends, targetUser.id] };
      }
      if (u.id === targetUser.id) {
        return { ...u, friends: [...u.friends, user.id] };
      }
      return u;
    }));
    setFriendUsername('');
    alert(`Added ${targetUser.username} as a friend!`);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('bloxcraft_current_user');
    setView('auth');
  };

  const createNewGame = () => {
    const newGame: Game = {
      id: nanoid(),
      name: `New Game ${games.length + 1}`,
      tree: JSON.parse(JSON.stringify(initialGameTree)),
      lastModified: Date.now(),
      ownerId: user?.id
    };
    setGames([...games, newGame]);
    setCurrentGameId(newGame.id);
    setGameTree(newGame.tree);
    setIsPlayOnlyMode(false);
    setView('editor');
  };

  const editGame = (id: string) => {
    const game = games.find(g => g.id === id);
    if (game) {
      setCurrentGameId(id);
      setGameTree(game.tree || initialGameTree);
      setIsPlayOnlyMode(false);
      setView('editor');
    }
  };

  const playGame = (id: string) => {
    const game = games.find(g => g.id === id);
    if (game) {
      setCurrentGameId(id);
      setGameTree(game.tree || initialGameTree);
      setIsPlayOnlyMode(true);
      setView('editor');
    }
  };

  // 2D Studio Logic
  const draw = useCallback((objects: GameObject[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    objects.forEach(obj => {
        ctx.fillStyle = obj.color;
        if (obj.type === 'text' && obj.text) {
          ctx.font = obj.font || '20px sans-serif';
          ctx.fillText(obj.text, obj.x, obj.y);
        } else {
          ctx.fillRect(obj.x, obj.y, obj.w || 50, obj.h || 50);
        }
    });
  }, []);

  useEffect(() => {
    if (view !== 'editor') return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw(gameObjects);
    }
    
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setShowExplorer(true);
      
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        draw(gameObjects);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [gameObjects, view, draw]);

  const stopGame = () => {
    setIsPlaying(false);
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
    setGameObjects([]);
    draw([]);
  };

  const runGame = () => {
    setIsPlaying(true);
    setIsScriptOpen(false);
    
    let currentObjects: GameObject[] = [];
    let updateCallbacks: Function[] = [];
    let keys: Record<string, boolean> = {};
    let isRunning = true;

    const handleKeyDown = (e: KeyboardEvent) => { keys[e.key] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys[e.key] = false; };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const GameAPI = {
        state: {}, // For sharing data between scripts
        createPart: (x: number, y: number, color: string, w: number = 50, h: number = 50) => {
            const part: GameObject = { type: 'rect', x, y, color: color || 'white', w, h };
            currentObjects.push(part);
            return part;
        },
        createText: (text: string, x: number, y: number, color: string, font: string = '20px sans-serif') => {
            const part: GameObject = { type: 'text', text, x, y, color, font };
            currentObjects.push(part);
            return part;
        },
        destroyPart: (part: GameObject) => {
            const index = currentObjects.indexOf(part);
            if (index > -1) currentObjects.splice(index, 1);
        },
        onUpdate: (cb: Function) => {
            updateCallbacks.push(cb);
        },
        getKeys: () => keys,
        getCanvasWidth: () => canvasRef.current?.width || 800,
        getCanvasHeight: () => canvasRef.current?.height || 600,
        clear: () => {
            currentObjects = [];
            updateCallbacks = [];
        }
    };

    engineRef.current = {
      stop: () => {
        isRunning = false;
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      }
    };

    GameAPI.clear();

    const executeScripts = (nodes: TreeNode[] | Record<string, TreeNode>) => {
      const items = Array.isArray(nodes) ? nodes : Object.values(nodes);
      items.forEach(item => {
        if (item.type === 'script' && item.content) {
          try {
            const scriptFunc = new Function('game', item.content);
            scriptFunc(GameAPI);
          } catch(e) {
            console.error(`Erro no script ${item.name}: ` + e);
          }
        }
        if (item.children) {
          executeScripts(item.children);
        }
      });
    };

    executeScripts(gameTree);

    let lastTime = performance.now();
    const loop = (time: number) => {
      if (!isRunning) return;
      
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      updateCallbacks.forEach(cb => {
        try { cb(dt); } catch(e) { console.error(e); }
      });

      draw(currentObjects);
      requestAnimationFrame(loop);
    };
    
    requestAnimationFrame(loop);
  };

  useEffect(() => {
    if (view === 'editor' && isPlayOnlyMode && !isPlaying) {
      const timer = setTimeout(() => {
        runGame();
      }, 100);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isPlayOnlyMode, isPlaying]);

  const addScript = (parentNode: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const newScript: TreeNode = {
      name: `Script_${Math.floor(Math.random() * 1000)}`,
      icon: "📜",
      type: "script",
      content: "// Novo script\n"
    };

    const updateNode = (nodes: TreeNode[] | undefined): boolean => {
      if (!nodes) return false;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i] === parentNode) {
          if (!nodes[i].children) nodes[i].children = [];
          nodes[i].children!.push(newScript);
          return true;
        }
        if (updateNode(nodes[i].children)) return true;
      }
      return false;
    };
    
    const newTree = { ...gameTree };
    let found = false;
    for (const key in newTree) {
      if (newTree[key] === parentNode) {
        if (!newTree[key].children) newTree[key].children = [];
        newTree[key].children!.push(newScript);
        found = true;
      } else if (!found) {
        found = updateNode(newTree[key].children);
      }
    }
    setGameTree(newTree);
  };

  const openScript = (node: TreeNode) => {
    setActiveScript(node);
    setScriptContent(node.content || '');
    setIsScriptOpen(true);
  };

  const saveAndCompile = () => {
    if (activeScript) {
      const updateNode = (nodes: TreeNode[] | undefined): boolean => {
        if (!nodes) return false;
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i] === activeScript) {
            nodes[i].content = scriptContent;
            return true;
          }
          if (updateNode(nodes[i].children)) return true;
        }
        return false;
      };
      
      const newTree = { ...gameTree };
      for (const key in newTree) {
        if (newTree[key] === activeScript) {
          newTree[key].content = scriptContent;
        } else {
          updateNode(newTree[key].children);
        }
      }
      setGameTree(newTree);
      
      // Save to games list
      if (currentGameId) {
        setGames(prev => prev.map(g => g.id === currentGameId ? { ...g, tree: newTree, lastModified: Date.now() } : g));
      }
      
      alert("Script compilado e salvo!");
    }
  };

  const renderTree = (nodes: TreeNode[] | Record<string, TreeNode>, indent = 0) => {
    const items = Array.isArray(nodes) ? nodes : Object.values(nodes);
    return items.map((item, idx) => (
      <div key={idx} style={{ marginLeft: indent }}>
        <div 
          className="tree-item" 
          onClick={(e) => {
            e.stopPropagation();
            if (item.type === 'script') openScript(item);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <span>{item.icon}</span> {item.name}
          </div>
          {item.type !== 'script' && (
            <button 
              className="add-script-btn"
              onClick={(e) => addScript(item, e)}
              title="Add Script"
            >
              +
            </button>
          )}
        </div>
        {item.children && renderTree(item.children, 15)}
      </div>
    ));
  };

  if (view === 'auth') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-white/10 p-8 rounded-[32px] shadow-2xl">
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <BoxIcon className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-center text-white mb-2 tracking-tight">BloxCraft</h1>
          <p className="text-zinc-400 text-center mb-8 font-medium">Create, play, and explore together</p>
          
          <div className="flex gap-2 mb-8 bg-black/40 p-1 rounded-2xl">
            <button 
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${authMode === 'login' ? 'bg-zinc-800 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Log In
            </button>
            <button 
              onClick={() => setAuthMode('signup')}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${authMode === 'signup' ? 'bg-zinc-800 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Username</label>
              <input 
                type="text" 
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 transition-all font-medium"
                placeholder="Enter your username"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password" 
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 transition-all font-medium"
                placeholder="Enter your password"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-white text-black hover:bg-zinc-200 py-4 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-lg active:scale-95"
            >
              {authMode === 'login' ? 'Enter World' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        {/* Global Message Banner */}
        <AnimatePresence>
          {globalMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              className="bg-red-600 text-white text-center py-2 px-4 font-bold text-sm tracking-widest uppercase shadow-lg z-[100] relative"
            >
              <div className="flex items-center justify-center gap-2">
                <Shield className="w-4 h-4" />
                GLOBAL ANNOUNCEMENT: {globalMessage}
                {user?.isAdmin && (
                  <button 
                    onClick={() => setGlobalMessage(null)}
                    className="ml-4 text-white/50 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="border-b border-white/10 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <BoxIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight">BloxCraft</h1>
                <p className="text-xs text-zinc-400 font-medium">Welcome back, {user?.username}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {user?.isAdmin && (
                <button 
                  onClick={() => setIsAdminPanelOpen(true)}
                  className="p-2.5 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                  title="Admin Panel"
                >
                  <Shield className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={logout}
                className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                title="Log Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-12">
          {/* Friends Section */}
          <div className="mb-12 bg-zinc-900 border border-white/10 rounded-[32px] p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Friends ({user?.friends?.length || 0})
              </h2>
              <form onSubmit={addFriend} className="flex gap-2">
                <input 
                  type="text"
                  value={friendUsername}
                  onChange={(e) => setFriendUsername(e.target.value)}
                  placeholder="Username to add..."
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 text-sm"
                />
                <button 
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-500/20"
                >
                  Add
                </button>
              </form>
            </div>
            
            {user?.friends && user.friends.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2">
                {user.friends.map(friendId => {
                  const friend = allUsers.find(u => u.id === friendId);
                  if (!friend) return null;
                  return (
                    <div key={friendId} className="flex flex-col items-center gap-2 min-w-[80px]">
                      <div className="w-14 h-14 rounded-full bg-zinc-800 border-2 border-white/10 flex items-center justify-center text-xl font-black text-zinc-400">
                        {friend.username[0].toUpperCase()}
                      </div>
                      <span className="text-xs font-bold text-zinc-400 truncate w-full text-center">
                        {friend.username}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-600 font-medium text-sm">
                You don't have any friends yet. Add someone to start playing together!
              </div>
            )}
          </div>

          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="text-3xl font-black tracking-tight mb-2">Your Experiences</h2>
              <p className="text-zinc-400 font-medium">Create and manage your worlds</p>
            </div>
            <button 
              onClick={createNewGame}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Create New Experience
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {games.map(game => {
              const isOwner = !game.ownerId || game.ownerId === user?.id;
              return (
              <div 
                key={game.id}
                className="group bg-zinc-900 border border-white/10 rounded-[32px] p-6 transition-all relative"
              >
                <div 
                  onClick={() => playGame(game.id)}
                  className="aspect-video bg-black/40 rounded-2xl mb-6 flex items-center justify-center overflow-hidden relative cursor-pointer hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-500/10 transition-all"
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10" />
                  <Play className="w-12 h-12 text-zinc-700 group-hover:text-blue-500/50 transition-colors z-20" />
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold mb-2">{game.name}</h3>
                    <div className="flex items-center justify-between text-sm text-zinc-500 font-medium">
                      <span>Last edited {new Date(game.lastModified).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {isOwner && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); editGame(game.id); }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-white p-3 rounded-xl transition-colors"
                      title="Edit in Studio"
                    >
                      <Code className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            )})}
          </div>
        </main>

        {/* Admin Panel Modal */}
        <AnimatePresence>
          {isAdminPanelOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-[32px] overflow-hidden shadow-2xl"
              >
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-red-600/10">
                  <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-3 text-red-500">
                    <Shield className="w-6 h-6" />
                    Admin Control Center
                  </h2>
                  <button onClick={() => setIsAdminPanelOpen(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">×</button>
                </div>
                
                <div className="p-6 border-b border-white/10 bg-black/20">
                  <form onSubmit={handleAdminCommand} className="flex gap-4">
                    <input 
                      type="text"
                      value={adminCommand}
                      onChange={(e) => setAdminCommand(e.target.value)}
                      placeholder="e.g. ban player123, unban player123, global Hello!"
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500/50 transition-all font-mono text-sm"
                    />
                    <button 
                      type="submit"
                      className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-600/20 active:scale-95"
                    >
                      Execute
                    </button>
                  </form>
                </div>

                <div className="p-8 max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] uppercase font-black text-zinc-500 tracking-widest border-b border-white/5">
                        <th className="pb-4">User</th>
                        <th className="pb-4">Joined</th>
                        <th className="pb-4">Status</th>
                        <th className="pb-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {allUsers.map(u => (
                        <tr key={u.id} className="group">
                          <td className="py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold">
                                {u.username[0].toUpperCase()}
                              </div>
                              <span className="font-bold">{u.username} {u.id === user?.id && '(You)'}</span>
                            </div>
                          </td>
                          <td className="py-4 text-xs text-zinc-500">{new Date(u.joinedAt).toLocaleDateString()}</td>
                          <td className="py-4">
                            {bannedUserIds.includes(u.id) ? (
                              <span className="text-[8px] font-black uppercase bg-red-500/20 text-red-500 px-2 py-1 rounded">Banned</span>
                            ) : (
                              <span className="text-[8px] font-black uppercase bg-emerald-500/20 text-emerald-500 px-2 py-1 rounded">Active</span>
                            )}
                          </td>
                          <td className="py-4 text-right">
                            {u.id !== user?.id && !u.isAdmin && (
                              bannedUserIds.includes(u.id) ? (
                                <button 
                                  onClick={() => unbanUser(u.id)}
                                  className="text-[10px] font-black uppercase text-emerald-400 hover:underline"
                                >
                                  Unban
                                </button>
                              ) : (
                                <button 
                                  onClick={() => banUser(u.id)}
                                  className="text-[10px] font-black uppercase text-red-400 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  Ban
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // 2D Studio Editor View
  if (isPlayOnlyMode) {
    return (
      <div style={{ background: '#000', height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {globalMessage && (
          <div style={{ background: '#dc2626', color: 'white', textAlign: 'center', padding: '5px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', zIndex: 100 }}>
            GLOBAL: {globalMessage}
          </div>
        )}
        <div style={{ position: 'absolute', top: globalMessage ? '40px' : '10px', left: '10px', zIndex: 100 }}>
          <button 
            onClick={() => { stopGame(); setView('lobby'); setIsPlayOnlyMode(false); }} 
            style={{ background: 'rgba(0,0,0,0.6)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', backdropFilter: 'blur(4px)' }}
          >
            ← Leave Game
          </button>
        </div>
        <canvas ref={canvasRef} style={{ background: '#111', width: '100%', height: '100%', display: 'block' }}></canvas>
      </div>
    );
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#ccc', fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .tree-item { padding: 5px 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tree-item:hover { background: #333; }
        .add-script-btn { background: transparent; color: #00ff00; border: none; cursor: pointer; font-weight: bold; font-size: 18px; opacity: 0.3; padding: 0 5px; transition: opacity 0.2s; }
        .tree-item:hover .add-script-btn { opacity: 1; }
        .add-script-btn:hover { opacity: 1; color: #fff; }
        .run-btn { background: #28a745; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; font-weight: bold; }
        .run-btn:hover { background: #218838; }
        .stop-btn { background: #dc3545; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; font-weight: bold; }
        .stop-btn:hover { background: #c82333; }
        textarea { flex: 1; background: #1e1e1e; color: #d4d4d4; padding: 15px; font-family: monospace; border: none; outline: none; font-size: 14px; resize: none; }
        .btns { padding: 10px; display: flex; gap: 10px; background: #2d2d2d; justify-content: flex-end; }
        .close-btn { background: #444; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; }
        .close-btn:hover { background: #555; }
        .back-btn { background: #444; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; font-weight: bold; margin-right: 10px; }
        .back-btn:hover { background: #555; }
        .toggle-explorer-btn { background: #444; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-weight: bold; margin-right: 10px; }
      `}</style>
      
      <header style={{ height: '40px', background: '#252526', borderBottom: '1px solid #3c3c3c', display: 'flex', alignItems: 'center', padding: '0 15px', fontWeight: 'bold', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="back-btn" onClick={() => {
              if (isPlaying) stopGame();
              setView('lobby');
            }}>← LOBBY</button>
            {isMobile && !isPlaying && (
              <button className="toggle-explorer-btn" onClick={() => setShowExplorer(!showExplorer)}>
                {showExplorer ? 'Hide Explorer' : 'Show Explorer'}
              </button>
            )}
            {!isMobile && <span>BLOXCRAFT STUDIO v2.0 {isPlaying ? '- PLAYING' : ''}</span>}
            {isMobile && <span style={{ marginLeft: '10px', color: '#888', fontSize: '12px' }}>LITE</span>}
          </div>
          {isPlaying ? (
            <button className="stop-btn" onClick={stopGame}>⏹ PARAR JOGO</button>
          ) : (
            <button className="run-btn" onClick={runGame}>▶ RODAR JOGO</button>
          )}
      </header>

      {globalMessage && (
        <div style={{ background: '#dc2626', color: 'white', textAlign: 'center', padding: '5px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>
          GLOBAL: {globalMessage}
        </div>
      )}

      <main style={{ flex: 1, display: 'flex', position: 'relative' }}>
          <div id="viewport" style={{ flex: 1, background: '#000', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <canvas ref={canvasRef} style={{ background: '#111', width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}></canvas>
              
              {!isPlaying && isScriptOpen && (
                <div id="script-window" style={{ position: 'absolute', top: isMobile ? '0' : '50px', left: isMobile ? '0' : '50px', width: isMobile ? '100%' : '80%', height: isMobile ? '100%' : '80%', background: '#1e1e1e', border: isMobile ? 'none' : '2px solid #3c3c3c', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
                    <div style={{ padding: '10px', background: '#333', fontWeight: 'bold' }}>Editor de Script: <span style={{ color: '#00ff00' }}>{activeScript?.name}</span></div>
                    <textarea 
                      spellCheck="false" 
                      value={scriptContent}
                      onChange={(e) => setScriptContent(e.target.value)}
                    ></textarea>
                    <div className="btns">
                        <button className="close-btn" onClick={() => setIsScriptOpen(false)}>Fechar</button>
                        <button className="run-btn" onClick={saveAndCompile}>Compilar</button>
                    </div>
                </div>
              )}
          </div>

          {!isPlaying && showExplorer && (
            <div id="explorer" style={{ width: isMobile ? '100%' : '220px', position: isMobile ? 'absolute' : 'relative', right: 0, top: 0, bottom: 0, background: '#252526', borderLeft: '1px solid #3c3c3c', fontSize: '13px', overflowY: 'auto', zIndex: 5 }}>
                <div style={{ padding: '10px', background: '#333', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', display: 'flex', justifyContent: 'space-between' }}>
                  EXPLORER
                  {isMobile && <button onClick={() => setShowExplorer(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>✕</button>}
                </div>
                <div id="tree-root" style={{ paddingTop: '5px' }}>
                  {renderTree(gameTree)}
                </div>
            </div>
          )}
      </main>
    </div>
  );
}
