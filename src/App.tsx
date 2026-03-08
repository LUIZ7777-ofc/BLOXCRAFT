import React, { useState, useRef, useEffect } from 'react';

type GameObject = { x: number, y: number, color: string, w: number, h: number };

type TreeNode = {
  name: string;
  icon: string;
  type?: 'script' | 'folder';
  content?: string;
  children?: TreeNode[];
};

const initialGameTree: Record<string, TreeNode> = {
  Workspace: { name: "Workspace", icon: "🌍", children: [] },
  StarterPlayer: { name: "StarterPlayer", icon: "👤", children: [
      { name: "StarterPlayerScripts", icon: "📁", children: [
          { name: "MainScript", icon: "📜", type: "script", content: "// Use game.createPart(x, y, cor)\ngame.createPart(100, 100, 'red');\ngame.createPart(200, 150, 'lime');" }
      ]}
  ]}
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameObjects, setGameObjects] = useState<GameObject[]>([]);
  const [gameTree, setGameTree] = useState(initialGameTree);
  const [activeScript, setActiveScript] = useState<TreeNode | null>(null);
  const [scriptContent, setScriptContent] = useState('');
  const [isScriptOpen, setIsScriptOpen] = useState(false);

  const draw = (objects: GameObject[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    objects.forEach(obj => {
        ctx.fillStyle = obj.color;
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw(gameObjects);
    }
    
    const handleResize = () => {
      if (canvas) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        draw(gameObjects);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [gameObjects]);

  const runGame = () => {
    let currentObjects: GameObject[] = [];
    
    const GameAPI = {
        createPart: (x: number, y: number, color: string) => {
            currentObjects.push({ x, y, color: color || 'white', w: 50, h: 50 });
            setGameObjects([...currentObjects]);
            draw(currentObjects);
        },
        clear: () => {
            currentObjects = [];
            setGameObjects([]);
            draw([]);
        }
    };

    GameAPI.clear();
    const code = gameTree.StarterPlayer.children![0].children![0].content || '';
    try {
        const scriptFunc = new Function('game', code);
        scriptFunc(GameAPI);
    } catch(e) {
        alert("Erro no script: " + e);
    }
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
      alert("Script compilado!");
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
          <span>{item.icon}</span> {item.name}
        </div>
        {item.children && renderTree(item.children, 15)}
      </div>
    ));
  };

  return (
    <div style={{ background: '#1a1a1a', color: '#ccc', fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .tree-item { padding: 5px 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .tree-item:hover { background: #333; }
        .run-btn { background: #28a745; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; font-weight: bold; }
        .run-btn:hover { background: #218838; }
        textarea { flex: 1; background: #1e1e1e; color: #d4d4d4; padding: 15px; font-family: monospace; border: none; outline: none; font-size: 14px; resize: none; }
        .btns { padding: 10px; display: flex; gap: 10px; background: #2d2d2d; justify-content: flex-end; }
        .close-btn { background: #444; color: white; border: none; padding: 5px 15px; border-radius: 3px; cursor: pointer; }
        .close-btn:hover { background: #555; }
      `}</style>
      
      <header style={{ height: '40px', background: '#252526', borderBottom: '1px solid #3c3c3c', display: 'flex', alignItems: 'center', padding: '0 15px', fontWeight: 'bold', justifyContent: 'space-between' }}>
          <span>BLOXCRAFT STUDIO v2.0</span>
          <button className="run-btn" onClick={runGame}>▶ RODAR JOGO</button>
      </header>

      <main style={{ flex: 1, display: 'flex' }}>
          <div id="viewport" style={{ flex: 1, background: '#000', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <canvas ref={canvasRef} style={{ background: '#111', width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}></canvas>
              
              {isScriptOpen && (
                <div id="script-window" style={{ position: 'absolute', top: '50px', left: '50px', width: '80%', height: '80%', background: '#1e1e1e', border: '2px solid #3c3c3c', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
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

          <div id="explorer" style={{ width: '220px', background: '#252526', borderLeft: '1px solid #3c3c3c', fontSize: '13px', overflowY: 'auto' }}>
              <div style={{ padding: '10px', background: '#333', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>EXPLORER</div>
              <div id="tree-root" style={{ paddingTop: '5px' }}>
                {renderTree(gameTree)}
              </div>
          </div>
      </main>
    </div>
  );
}
