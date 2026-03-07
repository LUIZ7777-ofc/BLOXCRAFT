/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Sky, PointerLockControls, Stars, KeyboardControls, useKeyboardControls } from '@react-three/drei';
import { Physics, usePlane, useBox, useSphere } from '@react-three/cannon';
import * as THREE from 'three';
import { nanoid } from 'nanoid';
import { 
  Box as BoxIcon, 
  MessageSquare, 
  Image as ImageIcon, 
  Plus, 
  Trash2, 
  MousePointer2,
  Settings,
  Send,
  Sparkles,
  Maximize,
  LogOut,
  Shield,
  Code
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI, Type } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import io, { Socket } from 'socket.io-client';

// --- Global Types ---

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Types ---

type BlockType = 'grass' | 'dirt' | 'stone' | 'glass' | 'wood' | 'custom';

interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  isBanned: boolean;
  joinedAt: number;
}

interface Block {
  id: string;
  pos: [number, number, number];
  type: BlockType;
  texture?: string;
}

interface Game {
  id: string;
  name: string;
  blocks: Block[];
  scripts: string;
  creator?: string;
  lastModified: number;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

type View = 'lobby' | 'editor';

// --- Constants ---

const BLOCK_COLORS: Record<BlockType, string> = {
  grass: '#4ade80',
  dirt: '#78350f',
  stone: '#71717a',
  glass: '#bae6fd',
  wood: '#92400e',
  custom: '#ffffff',
};

// --- 3D Components ---

function Baseplate() {
  const [ref] = useBox(() => ({ 
    type: 'Static', 
    position: [0, -0.5, 0], 
    args: [100, 1, 100] 
  }));

  return (
    <mesh ref={ref as any} receiveShadow>
      <boxGeometry args={[100, 1, 100]} />
      <meshStandardMaterial color="#3f3f46" />
      <gridHelper args={[100, 100, "#52525b", "#27272a"]} rotation={[0, 0, 0]} position={[0, 0.51, 0]} />
    </mesh>
  );
}

function Cubes({ blocks, onRemove }: { blocks: Block[], onRemove: (id: string) => void }) {
  const { raycaster, camera, mouse } = useThree();
  
  // Group blocks by type for instancing
  const blocksByType = useMemo(() => {
    const groups: Record<string, Block[]> = {};
    if (!Array.isArray(blocks)) return groups;
    blocks.forEach(block => {
      if (!groups[block.type]) groups[block.type] = [];
      groups[block.type].push(block);
    });
    return groups;
  }, [blocks]);

  return (
    <>
      {Object.entries(blocksByType).map(([type, typeBlocks]) => (
        <InstancedCubes 
          key={type} 
          type={type as BlockType} 
          blocks={typeBlocks} 
          onRemove={onRemove} 
        />
      ))}
    </>
  );
}

function InstancedCubes({ type, blocks, onRemove }: { type: BlockType, blocks: Block[], onRemove: (id: string) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const transform = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;
    blocks.forEach((block, i) => {
      transform.position.set(...block.pos);
      transform.updateMatrix();
      meshRef.current!.setMatrixAt(i, transform.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [blocks, transform]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, blocks.length]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) {
          const block = blocks[e.instanceId];
          if (block && (e.button === 2 || (e.nativeEvent as any).altKey)) {
            onRemove(block.id);
          }
        }
      }}
    >
      <boxGeometry />
      <meshStandardMaterial 
        color={BLOCK_COLORS[type]} 
        transparent={type === 'glass'}
        opacity={type === 'glass' ? 0.6 : 1}
      />
    </instancedMesh>
  );
}

// Physics bodies (invisible)
function PhysicsBlock({ position }: { position: [number, number, number] }) {
  useBox(() => ({ type: 'Static', position }));
  return null;
}

function Player({ onAddBlock }: { onAddBlock: (x: number, y: number, z: number) => void }) {
  const { camera } = useThree();
  const [, getKeys] = useKeyboardControls();
  
  const [ref, api] = useSphere(() => ({
    mass: 1,
    type: 'Dynamic',
    position: [0, 5, 0],
    args: [0.5],
    fixedRotation: true,
    friction: 0.1,
    linearDamping: 0.9, // Add damping to stop sliding
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => api.velocity.subscribe((v) => (velocity.current = v)), [api.velocity]);

  const pos = useRef([0, 0, 0]);
  useEffect(() => api.position.subscribe((p) => (pos.current = p)), [api.position]);

  useFrame(() => {
    camera.position.copy(new THREE.Vector3(pos.current[0], pos.current[1] + 0.75, pos.current[2]));

    const { forward, backward, left, right, jump, shift } = getKeys();
    
    const direction = new THREE.Vector3();
    const frontVector = new THREE.Vector3(0, 0, Number(backward) - Number(forward));
    const sideVector = new THREE.Vector3(Number(left) - Number(right), 0, 0);

    const speed = shift ? 16 : 8; // Roblox speeds are usually around 16 studs/s

    direction
      .subVectors(frontVector, sideVector)
      .normalize()
      .multiplyScalar(speed)
      .applyEuler(camera.rotation);

    // Keep Y velocity for gravity/jumping
    api.velocity.set(direction.x, velocity.current[1], direction.z);

    if (jump && Math.abs(velocity.current[1]) < 0.1) {
      api.velocity.set(velocity.current[0], 6, velocity.current[2]);
    }
  });

  // Handle building
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== document.body) return;
      if (e.button === 0) { // Left click
        const target = new THREE.Vector3();
        camera.getWorldDirection(target);
        target.multiplyScalar(3).add(camera.position);
        
        onAddBlock(
          Math.round(target.x),
          Math.round(target.y),
          Math.round(target.z)
        );
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [camera, onAddBlock]);

  return <mesh ref={ref as any} />;
}

// --- Main App Component ---

export default function App() {
  const [view, setView] = useState<View | 'auth'>('auth');
  const [user, setUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [bannedUserIds, setBannedUserIds] = useState<string[]>([]);
  const [games, setGames] = useState<Game[]>([]);

  // Load users and banned list from localStorage
  useEffect(() => {
    const savedUsers = localStorage.getItem('bloxcraft_users');
    const savedBanned = localStorage.getItem('bloxcraft_banned');
    if (savedUsers) setAllUsers(JSON.parse(savedUsers));
    if (savedBanned) setBannedUserIds(JSON.parse(savedBanned));
  }, []);

  // Save users and banned list to localStorage
  useEffect(() => {
    localStorage.setItem('bloxcraft_users', JSON.stringify(allUsers));
  }, [allUsers]);

  useEffect(() => {
    localStorage.setItem('bloxcraft_banned', JSON.stringify(bannedUserIds));
  }, [bannedUserIds]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim()) return;

    const existingUser = allUsers.find(u => u.username.toLowerCase() === authUsername.toLowerCase());

    if (authMode === 'login') {
      if (existingUser) {
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
          isAdmin: authUsername === 'laikinhomiproooooo',
          isBanned: false,
          joinedAt: Date.now()
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

  const logout = () => {
    setUser(null);
    setView('auth');
  };
  const [publicGames, setPublicGames] = useState<Game[]>([]);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activeType, setActiveType] = useState<BlockType>('grass');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isImageGenOpen, setIsImageGenOpen] = useState(false);
  const [isScriptPanelOpen, setIsScriptPanelOpen] = useState(false);
  const [gameScripts, setGameScripts] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedSize, setSelectedSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Fetch Public Games
  const fetchPublicGames = async () => {
    try {
      const res = await fetch('/api/games');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (Array.isArray(data)) {
        setPublicGames(data);
      }
    } catch (e) {
      console.error("Failed to fetch public games", e);
    }
  };

  // Socket Connection
  useEffect(() => {
    try {
      socketRef.current = io();
      
      socketRef.current.on('block-added', (block: Block) => {
        setBlocks(prev => {
          if (prev.find(b => b.id === block.id)) return prev;
          return [...prev, block];
        });
      });

      socketRef.current.on('block-removed', (blockId: string) => {
        setBlocks(prev => prev.filter(b => b.id !== blockId));
      });

      socketRef.current.on('game-state', (remoteBlocks: Block[]) => {
        if (Array.isArray(remoteBlocks)) {
          setBlocks(remoteBlocks);
        }
      });

      socketRef.current.on('connect_error', (err) => {
        console.error("Socket connection error:", err);
      });
    } catch (e) {
      console.error("Socket initialization failed", e);
    }

    fetchPublicGames();

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Join room when entering game
  useEffect(() => {
    if (currentGameId && socketRef.current) {
      socketRef.current.emit('join-game', currentGameId);
    }
  }, [currentGameId]);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true); // Assume success as per guidelines
    }
  };

  // Load games from local storage
  useEffect(() => {
    const saved = localStorage.getItem('bloxcraft-games');
    if (saved) {
      try {
        setGames(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load games", e);
      }
    } else {
      // Initialize with a starter world
      const starterGame: Game = {
        id: 'starter-world',
        name: 'Starter World',
        blocks: [
          { id: 'b1', pos: [0, 0, 0], type: 'grass' },
          { id: 'b2', pos: [1, 0, 0], type: 'grass' },
          { id: 'b3', pos: [-1, 0, 0], type: 'grass' },
          { id: 'b4', pos: [0, 0, 1], type: 'grass' },
          { id: 'b5', pos: [0, 0, -1], type: 'grass' },
          { id: 'b6', pos: [0, 1, 0], type: 'stone' },
          { id: 'b7', pos: [1, 1, 0], type: 'stone' },
          { id: 'b8', pos: [-1, 1, 0], type: 'stone' },
          { id: 'b9', pos: [0, 2, 0], type: 'glass' },
        ],
        scripts: '// Welcome to BloxCraft Studio!\n// You can write game settings here.\n\nconst config = {\n  gravity: -9.81,\n  jumpForce: 4,\n  speed: 5\n};',
        lastModified: Date.now()
      };
      setGames([starterGame]);
    }
  }, []);

  // Save games to local storage (debounced)
  useEffect(() => {
    const timeout = setTimeout(() => {
      localStorage.setItem('bloxcraft-games', JSON.stringify(games));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [games]);

  // Sync blocks and scripts with current game
  useEffect(() => {
    if (currentGameId) {
      const game = games.find(g => g.id === currentGameId);
      if (game) {
        setBlocks(game.blocks);
        setGameScripts(game.scripts || '');
      }
    }
  }, [currentGameId]);

  // Update game blocks and scripts when they change
  useEffect(() => {
    if (currentGameId && view === 'editor') {
      setGames(prev => prev.map(g => 
        g.id === currentGameId 
          ? { ...g, blocks, scripts: gameScripts, lastModified: Date.now() } 
          : g
      ));
    }
  }, [blocks, gameScripts, currentGameId, view]);

  const enterGame = (id: string, gameObj?: Game) => {
    // Clear current state to avoid seeing previous game blocks
    const game = gameObj || [...games, ...publicGames].find(g => g.id === id);
    if (game) {
      setBlocks(game.blocks || []);
      setGameScripts(game.scripts || '');
    } else {
      setBlocks([]);
      setGameScripts('');
    }
    setCurrentGameId(id);
    setView('editor');
  };

  const createNewGame = () => {
    const newGame: Game = {
      id: nanoid(),
      name: `New Game ${games.length + 1}`,
      blocks: [],
      scripts: '// New Game Script',
      lastModified: Date.now()
    };
    setGames(prev => [newGame, ...prev]);
    enterGame(newGame.id, newGame);
  };

  const publishGame = async () => {
    const game = games.find(g => g.id === currentGameId);
    if (!game) return;
    
    try {
      await fetch('/api/games/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...game, blocks, scripts: gameScripts })
      });
      fetchPublicGames();
      alert("Game published to Public Experiences!");
    } catch (e) {
      console.error("Publish failed", e);
    }
  };

  const deleteGame = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setGames(prev => prev.filter(g => g.id !== id));
  };

  const addBlock = useCallback((x: number, y: number, z: number) => {
    const newBlock: Block = { id: nanoid(), pos: [x, y, z], type: activeType };
    setBlocks((prev) => [...prev, newBlock]);
    socketRef.current?.emit('block-added', { gameId: currentGameId, block: newBlock });
  }, [activeType, currentGameId]);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    socketRef.current?.emit('block-removed', { gameId: currentGameId, blockId: id });
  }, [currentGameId]);

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: userMsg,
        config: {
          systemInstruction: "You are an expert game designer and assistant for BloxCraft, a 3D sandbox game. Help the user with building ideas, game mechanics, or creative inspiration. Keep responses concise and helpful.",
        }
      });
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || "I couldn't generate a response." }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', text: "Sorry, I'm having trouble connecting right now." }]);
    }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim()) return;
    if (!hasApiKey) {
      await handleSelectKey();
      return;
    }
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: imagePrompt }] },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: selectedSize
          }
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedImages(prev => [imageUrl, ...prev]);
        }
      }
    } catch (error) {
      console.error("Image gen error:", error);
      if (error instanceof Error && error.message.includes("Requested entity was not found")) {
        setHasApiKey(false);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  if (view === 'auth') {
    return (
      <div className="w-full h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-[32px] p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
              <BoxIcon className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter italic">BLOXCRAFT</h1>
            <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mt-2">Account Required</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 ml-1">Username</label>
              <input 
                type="text"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="Enter your nickname..."
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder:text-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-all font-bold"
              />
            </div>

            <button 
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-2xl transition-all shadow-lg shadow-emerald-600/20 active:scale-[0.98]"
            >
              {authMode === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-xs font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest"
            >
              {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Log In"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (view === 'lobby') {
    return (
      <div className="w-full h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
        {/* Lobby Header */}
        <div className="p-8 border-b border-white/5 bg-zinc-900/50 backdrop-blur-xl flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-3xl font-black tracking-tighter italic flex items-center gap-3">
                <BoxIcon className="w-8 h-8 text-emerald-400" />
                BLOXCRAFT STUDIO
              </h1>
              <p className="text-xs uppercase tracking-widest opacity-40 mt-1 font-bold">Create • Build • Share</p>
            </div>
            
            <div className="h-12 w-px bg-white/10" />
            
            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/5">
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-xs font-bold">
                {user?.username[0].toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-black text-white">{user?.username}</p>
                <p className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">{user?.isAdmin ? 'Admin' : 'Player'}</p>
              </div>
              <button onClick={logout} className="ml-2 p-2 hover:bg-white/10 rounded-lg transition-colors">
                <LogOut className="w-4 h-4 opacity-40" />
              </button>
            </div>
          </div>

          <div className="flex gap-4">
            {user?.isAdmin && (
              <button 
                onClick={() => setIsAdminPanelOpen(true)}
                className="bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all flex items-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Admin Panel
              </button>
            )}
            <button 
              onClick={createNewGame}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Create New Experience
            </button>
          </div>
        </div>

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
                
                <div className="p-8 max-h-[60vh] overflow-y-auto">
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
                                  className="text-[10px] font-black uppercase text-red-500 hover:underline"
                                >
                                  Ban Player
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

        {/* Game List */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto space-y-12">
            <section>
              <h2 className="text-sm uppercase tracking-widest opacity-40 font-bold mb-6">My Experiences</h2>
              
              {games.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-white/5 rounded-3xl opacity-30">
                  <BoxIcon className="w-16 h-16 mb-4" />
                  <p className="text-lg font-medium">No experiences found. Create your first one!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {games.map(game => (
                    <motion.div
                      key={game.id}
                      whileHover={{ y: -4 }}
                      onClick={() => enterGame(game.id)}
                      className="group relative bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden cursor-pointer hover:border-emerald-500/50 transition-all"
                    >
                      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
                        <BoxIcon className="w-12 h-12 opacity-20 group-hover:scale-110 transition-transform" />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                          <div className="text-[10px] uppercase font-bold opacity-60 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md">
                            {game.blocks.length} Blocks
                          </div>
                        </div>
                      </div>
                      <div className="p-5 flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-lg group-hover:text-emerald-400 transition-colors">{game.name}</h3>
                          <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">
                            Modified {new Date(game.lastModified).toLocaleDateString()}
                          </p>
                          <p className="text-[8px] opacity-30 uppercase font-bold mt-1">
                            {(game.blocks || []).length} Blocks
                          </p>
                        </div>
                        <button 
                          onClick={(e) => deleteGame(game.id, e)}
                          className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm uppercase tracking-widest opacity-40 font-bold">Public Experiences</h2>
                <button 
                  onClick={fetchPublicGames}
                  className="text-[10px] uppercase tracking-widest font-bold hover:text-emerald-400 transition-colors"
                >
                  Refresh
                </button>
              </div>
              
              {publicGames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-3xl opacity-30">
                  <p className="text-sm font-medium">No public experiences yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {publicGames.map(game => (
                    <motion.div
                      key={game.id}
                      whileHover={{ y: -4 }}
                      onClick={() => enterGame(game.id)}
                      className="group relative bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden cursor-pointer hover:border-emerald-500/50 transition-all"
                    >
                      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
                        <Sparkles className="w-12 h-12 opacity-20 group-hover:scale-110 transition-transform" />
                        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-transparent" />
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                          <div className="text-[10px] uppercase font-bold opacity-60 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md">
                            {game.blocks.length} Blocks
                          </div>
                        </div>
                      </div>
                      <div className="p-5">
                        <h3 className="font-bold text-lg group-hover:text-emerald-400 transition-colors">{game.name}</h3>
                        <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">
                          By {game.creator || 'Anonymous'} • {(game.blocks || []).length} Blocks
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 text-center opacity-30 text-[10px] uppercase tracking-widest font-bold">
          Powered by Gemini AI • Built with React Three Fiber
        </div>
      </div>
    );
  }

  return (
    <KeyboardControls
      map={[
        { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
        { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
        { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
        { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
        { name: 'jump', keys: ['Space'] },
        { name: 'shift', keys: ['Shift'] },
      ]}
    >
      <div className="relative w-full h-screen bg-zinc-950 overflow-hidden font-sans text-zinc-100">
        {/* Roblox Top Bar */}
        <div className="absolute top-0 left-0 right-0 h-12 bg-black/20 backdrop-blur-sm z-50 flex items-center px-2 justify-between pointer-events-none">
          <div className="flex items-center gap-1 pointer-events-auto">
            <button 
              onClick={() => setView('lobby')}
              className="w-9 h-9 flex items-center justify-center hover:bg-white/10 rounded transition-colors"
            >
              <img src="https://upload.wikimedia.org/wikipedia/commons/3/3a/Roblox_player_icon_black.svg" className="w-6 h-6 invert" alt="Menu" referrerPolicy="no-referrer" />
            </button>
            <button 
              onClick={() => setIsChatOpen(!isChatOpen)}
              className={`w-9 h-9 flex items-center justify-center hover:bg-white/10 rounded transition-colors ${isChatOpen ? 'bg-white/20' : ''}`}
            >
              <MessageSquare className="w-5 h-5 text-white" />
            </button>
            <button 
              onClick={() => setIsScriptPanelOpen(!isScriptPanelOpen)}
              className={`w-9 h-9 flex items-center justify-center hover:bg-white/10 rounded transition-colors ${isScriptPanelOpen ? 'bg-white/20' : ''}`}
            >
              <Code className="w-5 h-5 text-white" />
            </button>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="bg-black/40 px-3 py-1 rounded flex items-center gap-2 border border-white/10">
              <span className="text-xs font-bold text-white/80">Experience:</span>
              <span className="text-xs font-bold text-white truncate max-w-[150px]">
                {games.find(g => g.id === currentGameId)?.name || 'Untitled'}
              </span>
            </div>
            <button 
              onClick={publishGame}
              className="bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-1 rounded text-xs font-bold transition-colors"
            >
              Publish
            </button>
          </div>
        </div>

        {/* Player List (Top Right) */}
        <div className="absolute top-14 right-2 w-48 bg-black/40 backdrop-blur-md rounded-lg border border-white/10 z-40 pointer-events-none overflow-hidden">
          <div className="bg-black/20 px-3 py-1.5 border-b border-white/5 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Players</span>
            <span className="text-[10px] font-black text-white/40">1/100</span>
          </div>
          <div className="p-1">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-white/10 rounded">
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white">
                P
              </div>
              <span className="text-xs font-bold text-white truncate">Player (You)</span>
            </div>
          </div>
        </div>

        {/* 3D Viewport */}
        <div className="absolute inset-0 z-0">
          <Canvas 
            shadows={{ type: THREE.BasicShadowMap }}
            camera={{ fov: 75, near: 0.1, far: 1000 }}
            dpr={[1, 1.5]}
            gl={{ antialias: false, powerPreference: "high-performance" }}
            onPointerDown={(e) => (e.target as HTMLElement).focus()}
          >
            <Sky sunPosition={[100, 10, 100]} />
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} castShadow intensity={1} shadow-mapSize={[512, 512]} />
            
            <Physics gravity={[0, -20, 0]}>
              <Baseplate />
              <Cubes blocks={blocks} onRemove={removeBlock} />
              {/* Only render physics for blocks to keep collisions working */}
              {blocks.map(block => (
                <PhysicsBlock key={`phys-${block.id}`} position={block.pos} />
              ))}
              <Player onAddBlock={addBlock} />
            </Physics>
            
            <PointerLockControls 
              makeDefault 
              onLock={() => setIsLocked(true)} 
              onUnlock={() => setIsLocked(false)} 
            />
          </Canvas>
        </div>

        {/* HUD / UI Overlay */}
        <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-6 pt-16">
          {/* Top Bar - Removed old one */}
          <div />

          {/* Crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white/50 rounded-full pointer-events-none" />

          {/* Bottom Toolbar - Roblox Style Hotbar */}
          <div className="flex flex-col items-center gap-4 pointer-events-auto">
            {!isLocked && (
              <div className="bg-black/60 backdrop-blur-md px-6 py-3 rounded-lg text-sm font-bold text-white animate-pulse border border-white/10">
                Click anywhere to play
              </div>
            )}
            
            <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
              {(['grass', 'dirt', 'stone', 'glass', 'wood'] as BlockType[]).map((type, index) => (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`relative w-14 h-14 rounded-md border-2 transition-all flex items-center justify-center overflow-hidden ${
                    activeType === type ? 'border-white scale-105 bg-white/20' : 'border-transparent bg-black/40 hover:bg-black/60'
                  }`}
                >
                  <div 
                    className="w-10 h-10 rounded shadow-inner"
                    style={{ backgroundColor: BLOCK_COLORS[type] }}
                  />
                  <span className="absolute top-0.5 left-1 text-[10px] font-black text-white/50">{index + 1}</span>
                </button>
              ))}
              <button 
                onClick={() => setIsImageGenOpen(!isImageGenOpen)}
                className={`w-14 h-14 rounded-md border-2 transition-all flex items-center justify-center bg-black/40 hover:bg-black/60 border-transparent`}
              >
                <ImageIcon className="w-6 h-6 text-white/60" />
              </button>
            </div>
          </div>
        </div>

        {/* Side Panels */}
        <AnimatePresence>
          {/* Escape Menu (Roblox Style) */}
          {!isLocked && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center pointer-events-auto"
            >
              <div className="w-[600px] bg-[#2d2d2d] rounded-lg shadow-2xl border border-white/5 overflow-hidden">
                <div className="bg-[#393939] px-6 py-4 flex justify-between items-center border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/3/3a/Roblox_player_icon_black.svg" className="w-6 h-6 invert" alt="Roblox" referrerPolicy="no-referrer" />
                    <span className="font-black text-white uppercase tracking-wider">Settings</span>
                  </div>
                  <button 
                    onClick={() => setIsLocked(true)}
                    className="text-white/40 hover:text-white transition-colors font-bold"
                  >
                    Resume Game
                  </button>
                </div>
                
                <div className="p-8 space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-black/20 p-4 rounded-lg">
                      <span className="text-sm font-bold text-white/80">Experience Name</span>
                      <span className="text-sm font-bold text-white">{games.find(g => g.id === currentGameId)?.name}</span>
                    </div>
                    <div className="flex justify-between items-center bg-black/20 p-4 rounded-lg">
                      <span className="text-sm font-bold text-white/80">Graphics Mode</span>
                      <span className="text-sm font-bold text-white">Automatic</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setView('lobby')}
                      className="w-full py-4 bg-[#4a4a4a] hover:bg-[#5a5a5a] text-white font-black uppercase tracking-widest rounded-lg transition-colors border-b-4 border-black/40 active:border-b-0 active:translate-y-1"
                    >
                      Leave Experience
                    </button>
                    <button 
                      onClick={() => setIsLocked(true)}
                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest rounded-lg transition-colors border-b-4 border-black/40 active:border-b-0 active:translate-y-1"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {isChatOpen && (
            <motion.div 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="absolute top-0 right-0 w-80 h-full bg-zinc-900/95 backdrop-blur-2xl border-l border-white/10 z-20 flex flex-col"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <h2 className="font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  AI Assistant
                </h2>
                <button onClick={() => setIsChatOpen(false)} className="opacity-50 hover:opacity-100">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="text-center py-12 opacity-30">
                    <MessageSquare className="w-12 h-12 mx-auto mb-2" />
                    <p className="text-sm">Ask me anything about building your world!</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      msg.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 border border-white/5'
                    }`}>
                      <div className="prose prose-invert prose-sm">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-white/10 flex gap-2">
                <input 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  placeholder="Ask Gemini..."
                  className="flex-1 bg-zinc-800 border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <button 
                  onClick={handleChat}
                  className="p-2 bg-emerald-600 rounded-xl hover:bg-emerald-500 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {isImageGenOpen && (
            <motion.div 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="absolute top-0 right-0 w-96 h-full bg-zinc-900/95 backdrop-blur-2xl border-l border-white/10 z-20 flex flex-col"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <h2 className="font-bold flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-emerald-400" />
                  Asset Generator
                </h2>
                <button onClick={() => setIsImageGenOpen(false)} className="opacity-50 hover:opacity-100">×</button>
              </div>
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-50">Prompt</label>
                  <textarea 
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    placeholder="Describe a texture or poster..."
                    className="w-full h-24 bg-zinc-800 border border-white/5 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-50">Resolution</label>
                  <div className="flex gap-2">
                    {(['1K', '2K', '4K'] as const).map(size => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border ${
                          selectedSize === size ? 'bg-emerald-600 border-emerald-400' : 'bg-zinc-800 border-white/5 opacity-50'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <button 
                  onClick={generateImage}
                  disabled={isGenerating}
                  className="w-full py-3 bg-emerald-600 rounded-xl font-bold hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isGenerating ? 'Generating...' : 'Generate Asset'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-2">
                {generatedImages.map((img, i) => (
                  <div key={i} className="group relative aspect-square rounded-xl overflow-hidden bg-zinc-800 border border-white/5">
                    <img src={img} alt="Generated" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button className="p-2 bg-white/10 rounded-lg hover:bg-white/20">
                        <Maximize className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {isScriptPanelOpen && (
            <motion.div 
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="absolute top-0 right-0 w-[450px] h-full bg-zinc-900/95 backdrop-blur-2xl border-l border-white/10 z-20 flex flex-col"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <h2 className="font-bold flex items-center gap-2">
                  <Code className="w-4 h-4 text-emerald-400" />
                  Script Editor
                </h2>
                <button onClick={() => setIsScriptPanelOpen(false)} className="opacity-50 hover:opacity-100">×</button>
              </div>
              <div className="flex-1 p-4">
                <div className="h-full bg-zinc-950 rounded-2xl border border-white/5 overflow-hidden flex flex-col">
                  <div className="p-2 bg-zinc-900 border-b border-white/5 flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/50" />
                  </div>
                  <textarea
                    value={gameScripts}
                    onChange={(e) => setGameScripts(e.target.value)}
                    className="flex-1 w-full bg-transparent p-4 font-mono text-sm text-emerald-400/80 focus:outline-none resize-none leading-relaxed"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="p-4 border-t border-white/10">
                <p className="text-[10px] uppercase font-bold opacity-30">
                  Scripts are auto-saved to this experience.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </KeyboardControls>
    );
  }
