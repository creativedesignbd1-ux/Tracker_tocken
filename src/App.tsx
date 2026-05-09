/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, type ReactNode, type ChangeEvent, type DragEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileJson, 
  Upload, 
  Coins, 
  Zap, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  Info,
  ChevronRight,
  TrendingUp,
  PieChart as PieChartIcon,
  Trash2,
  ExternalLink,
  Users,
  LogOut,
  LogIn,
  Trophy,
  History,
  ShieldCheck,
  LayoutDashboard
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { cn } from '@/src/lib/utils';
import { auth, db, googleProvider } from '@/src/lib/firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  type User 
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  updateDoc, 
  getDoc, 
  collection, 
  query, 
  orderBy, 
  limit, 
  getDocs, 
  serverTimestamp,
  addDoc
} from 'firebase/firestore';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

interface Stats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  models: {
    name: string;
    input: number;
    output: number;
    cost: number;
  }[];
}

interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  email: string;
  totalCost: number;
  totalTokens: number;
  lastActive: any;
}

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

// --- Helpers ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

const Card = ({ children, className, ...props }: { children: ReactNode; className?: string; [key: string]: any }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn("bg-white border border-gray-200 rounded-2xl p-6 shadow-sm", className)}
    {...props}
  >
    {children}
  </motion.div>
);

const StatCard = ({ title, value, icon: Icon, subValue, colorClass }: any) => (
  <Card className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-sm font-medium">{title}</span>
      <div className={cn("p-2 rounded-lg", colorClass)}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
    <div className="mt-1">
      <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </div>
  </Card>
);

// --- Main App ---

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'stats' | 'leaderboard'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        syncUserProfile(user);
      } else {
        setUserProfile(null);
      }
    });
  }, []);

  // Leaderboard fetch
  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    }
  }, [activeTab]);

  const syncUserProfile = async (user: User) => {
    const profileRef = doc(db, 'profiles', user.uid);
    try {
      const snap = await getDoc(profileRef);
      if (!snap.exists()) {
        const newProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Anonymous',
          photoURL: user.photoURL || '',
          email: user.email || '',
          totalCost: 0,
          totalTokens: 0,
          lastActive: serverTimestamp()
        };
        await setDoc(profileRef, newProfile);
        setUserProfile(newProfile as UserProfile);
      } else {
        setUserProfile(snap.data() as UserProfile);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `profiles/${user.uid}`);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, 'profiles'), orderBy('totalCost', 'desc'), limit(10));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => d.data() as UserProfile);
      setLeaderboard(data);
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'profiles');
    }
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError("Failed to login with Google.");
    }
  };

  const logout = async () => {
    await signOut(auth);
    setStats(null);
  };

  const processJson = async (content: string) => {
    try {
      const data = JSON.parse(content);
      
      let processed: Stats = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
        models: []
      };

      if (data.totalTokens) {
        processed.inputTokens = data.totalTokens.input || 0;
        processed.outputTokens = data.totalTokens.output || 0;
        processed.cacheReadTokens = data.totalTokens.cache_read || data.totalTokens.cacheRead || 0;
        processed.cacheWriteTokens = data.totalTokens.cache_write || data.totalTokens.cacheWrite || 0;
        processed.totalCost = data.totalCost || data.cost || 0;
        
        if (data.usageByModel || data.models) {
          const rawModels = data.usageByModel || data.models;
          processed.models = Object.entries(rawModels).map(([name, m]: [string, any]) => ({
            name,
            input: m.input || 0,
            output: m.output || 0,
            cost: m.cost || 0
          }));
        }
      } else if (Array.isArray(data)) {
        data.forEach(item => {
          processed.inputTokens += item.input_tokens || 0;
          processed.outputTokens += item.output_tokens || 0;
          processed.totalCost += item.cost || 0;
        });
      } else {
        throw new Error("unrecognized format");
      }

      setStats(processed);
      setError(null);

      // Sync to cloud
      if (currentUser) {
        await syncStatsToCloud(processed);
      }
    } catch (e) {
      setError("Invalid JSON format. Run 'claude-code --stats --json > stats.json'");
    }
  };

  const syncStatsToCloud = async (newStats: Stats) => {
    if (!currentUser) return;
    setIsSyncing(true);
    try {
      // 1. Add submission history
      await addDoc(collection(db, 'submissions'), {
        userId: currentUser.uid,
        timestamp: serverTimestamp(),
        cost: newStats.totalCost,
        tokens: newStats.inputTokens + newStats.outputTokens,
        statsData: newStats
      });

      // 2. Update profile (Overwrite with latest stats for the specific time period or keep cumulative?)
      // Usually, Claude stats --json is cumulative since installation. 
      // We will set this as the user's current total.
      const profileRef = doc(db, 'profiles', currentUser.uid);
      await updateDoc(profileRef, {
        totalCost: newStats.totalCost,
        totalTokens: newStats.inputTokens + newStats.outputTokens,
        lastActive: serverTimestamp()
      });
      
      // Update local state
      setUserProfile(prev => prev ? {
        ...prev,
        totalCost: newStats.totalCost,
        totalTokens: newStats.inputTokens + newStats.outputTokens
      } : null);

    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'submissions/profiles');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => processJson(event.target?.result as string);
    reader.readAsText(file);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === "application/json" || file.name.endsWith('.json'))) {
      const reader = new FileReader();
      reader.onload = (event) => processJson(event.target?.result as string);
      reader.readAsText(file);
    }
  };

  const chartData = stats ? [
    { name: 'Input', value: stats.inputTokens, fill: '#3b82f6' },
    { name: 'Output', value: stats.outputTokens, fill: '#8b5cf6' },
  ] : [];

  const modelPieData = stats?.models.map(m => ({
    name: m.name,
    value: m.input + m.output
  })) || [];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-gray-900 font-sans selection:bg-violet-100 pb-20">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-md bg-white/80 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Zap className="text-white w-5 h-5 fill-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden sm:block">Claude Team Tracker</h1>
          </div>
          
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab('stats')}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                activeTab === 'stats' ? "bg-white text-black shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Stats
            </button>
            <button 
              onClick={() => setActiveTab('leaderboard')}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                activeTab === 'leaderboard' ? "bg-white text-black shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Trophy className="w-4 h-4" />
              Team
            </button>
          </div>

          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="flex items-center gap-3">
                <div className="hidden md:block text-right">
                  <p className="text-xs font-bold">{currentUser.displayName}</p>
                  <p className="text-[10px] text-gray-500">${userProfile?.totalCost.toFixed(2) || '0.00'}</p>
                </div>
                <img 
                  src={currentUser.photoURL || ''} 
                  className="w-8 h-8 rounded-full border border-gray-200" 
                  alt="Avatar"
                />
                <button 
                  onClick={logout}
                  className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors text-gray-500"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={login}
                className="flex items-center gap-2 px-4 py-1.5 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-all"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'stats' ? (
          <section className="space-y-8">
            {/* Sync Alert */}
            {isSyncing && (
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-violet-600 animate-pulse bg-violet-50 py-2 rounded-xl border border-violet-100">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing with team cloud...
              </div>
            )}

            {/* Dashboard Headers */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Usage Dashboard</h2>
                <p className="text-gray-500 mt-1">Track your personal Claude Code CLI token consumption.</p>
              </div>
              {!currentUser && (
                <div className="bg-amber-50 border border-amber-100 p-3 rounded-2xl flex items-start gap-3 max-w-sm">
                  <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>Private Mode:</strong> Sign in to sync your stats with the team leaderboard and persist your history.
                  </p>
                </div>
              )}
            </div>

            {/* Upload Area */}
            {!stats || error ? (
              <motion.div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "relative group cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed transition-all duration-300 min-h-[300px] flex flex-col items-center justify-center gap-4 p-8",
                  isDragging ? "border-violet-500 bg-violet-50/50" : "border-gray-300 hover:border-gray-400 bg-white"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Upload className={cn("w-8 h-8", isDragging ? "text-violet-500" : "text-gray-400")} />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-semibold">Drop your stats.json here</h3>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto mt-2">
                    Get your usage stats by running <code className="bg-gray-100 px-1.5 py-0.5 rounded text-violet-600 font-mono text-xs">claude-code --stats --json</code> and saving output.
                  </p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept=".json"
                />
                {error && (
                  <div className="absolute bottom-4 left-0 right-0 px-4">
                    <div className="bg-red-50 text-red-600 text-xs py-2 px-4 rounded-full flex items-center justify-center gap-2 animate-bounce">
                      <Info className="w-3 h-3" />
                      {error}
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard 
                    title="Total Cost" 
                    value={`$${stats.totalCost.toFixed(2)}`} 
                    icon={Coins} 
                    subValue="Cumulative USD" 
                    colorClass="bg-emerald-50 text-emerald-600"
                  />
                  <StatCard 
                    title="Total Tokens" 
                    value={(stats.inputTokens + stats.outputTokens).toLocaleString()} 
                    icon={Zap} 
                    subValue="Input + Output" 
                    colorClass="bg-amber-50 text-amber-600"
                  />
                  <StatCard 
                    title="Input Tokens" 
                    value={stats.inputTokens.toLocaleString()} 
                    icon={ArrowDownLeft} 
                    subValue={`${((stats.inputTokens / (stats.inputTokens + stats.outputTokens)) * 100).toFixed(0)}% of total`} 
                    colorClass="bg-blue-50 text-blue-600"
                  />
                  <StatCard 
                    title="Output Tokens" 
                    value={stats.outputTokens.toLocaleString()} 
                    icon={ArrowUpRight} 
                    subValue={`${((stats.outputTokens / (stats.inputTokens + stats.outputTokens)) * 100).toFixed(0)}% of total`} 
                    colorClass="bg-violet-50 text-violet-600"
                  />
                </div>

                <AnimatePresence>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-8"
                  >
                    {/* Secondary Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="flex items-center gap-4 border-l-4 border-l-sky-500">
                        <div className="p-3 bg-sky-50 rounded-xl">
                          <RefreshCw className="w-6 h-6 text-sky-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-gray-500">Cache Read Savings</h4>
                          <p className="text-xl font-bold">{stats.cacheReadTokens.toLocaleString()} tokens</p>
                        </div>
                      </Card>
                      <Card className="flex items-center gap-4 border-l-4 border-l-indigo-500">
                        <div className="p-3 bg-indigo-50 rounded-xl">
                          <TrendingUp className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-gray-500">Cache Write Tokens</h4>
                          <p className="text-xl font-bold">{stats.cacheWriteTokens.toLocaleString()} tokens</p>
                        </div>
                      </Card>
                    </div>

                    {/* Charts Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <Card className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="font-bold flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-violet-500" />
                            Token Distribution
                          </h3>
                        </div>
                        <div className="h-[300px] w-full text-xs">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} />
                              <YAxis axisLine={false} tickLine={false} />
                              <RechartsTooltip 
                                cursor={{ fill: '#f8fafc' }}
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                              />
                              <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={60} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>

                      <Card>
                        <h3 className="font-bold flex items-center gap-2 mb-6">
                          <PieChartIcon className="w-5 h-5 text-blue-500" />
                          Model Share
                        </h3>
                        <div className="h-[200px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={modelPieData}
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                              >
                                {modelPieData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-4 space-y-2">
                          {modelPieData.map((m, i) => (
                            <div key={m.name} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                                <span className="text-gray-600 truncate max-w-[120px]">{m.name}</span>
                              </div>
                              <span className="font-medium">{((m.value / (stats.inputTokens + stats.outputTokens)) * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </div>

                    {/* Model Table */}
                    <Card>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold flex items-center gap-2">
                          <FileJson className="w-5 h-5 text-gray-500" />
                          Model Breakdown (Recent Upload)
                        </h3>
                        <button 
                          onClick={() => { setStats(null); setError(null); }}
                          className="text-xs font-medium text-gray-400 hover:text-red-500 flex items-center gap-1"
                        >
                          Clear <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="pb-4 font-semibold text-sm text-gray-500">Model Name</th>
                              <th className="pb-4 font-semibold text-sm text-gray-500 text-right">Input</th>
                              <th className="pb-4 font-semibold text-sm text-gray-500 text-right">Output</th>
                              <th className="pb-4 font-semibold text-sm text-gray-500 text-right">Estimated Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {stats.models.map((m) => (
                              <tr key={m.name} className="group hover:bg-gray-50/50 transition-colors">
                                <td className="py-4 font-medium text-sm text-gray-900">{m.name}</td>
                                <td className="py-4 text-sm text-gray-600 text-right font-mono">{m.input.toLocaleString()}</td>
                                <td className="py-4 text-sm text-gray-600 text-right font-mono">{m.output.toLocaleString()}</td>
                                <td className="py-4 text-sm text-emerald-600 text-right font-semibold">${m.cost.toFixed(4)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </motion.div>
                </AnimatePresence>
              </>
            )}
          </section>
        ) : (
          <section className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Team Leaderboard</h2>
                <p className="text-gray-500 mt-1">See who is burning the most tokens in the group.</p>
              </div>
              <button 
                onClick={fetchLeaderboard}
                className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {leaderboard.length > 0 ? (
                leaderboard.map((profile, i) => (
                  <Card key={profile.uid} className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-6 border-l-4",
                    i === 0 ? "border-l-amber-400 bg-amber-50/20" : 
                    i === 1 ? "border-l-gray-300 bg-gray-50/20" : 
                    i === 2 ? "border-l-orange-300 bg-orange-50/20" : "border-l-transparent"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className="w-8 flex items-center justify-center font-bold text-gray-300 italic text-xl">
                        #{i + 1}
                      </div>
                      <img 
                        src={profile.photoURL} 
                        className="w-12 h-12 rounded-2xl object-cover ring-2 ring-white shadow-sm" 
                        alt={profile.displayName}
                      />
                      <div>
                        <h4 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                          {profile.displayName}
                          {i === 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Top Spender</span>}
                        </h4>
                        <p className="text-xs text-gray-500">Last active: {profile.lastActive?.toDate?.().toLocaleDateString() || 'Recently'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-8 sm:pr-4">
                      <div className="text-right">
                        <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Total Spent</p>
                        <p className="text-xl font-black text-emerald-600">${profile.totalCost.toFixed(2)}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Tokens</p>
                        <p className="text-lg font-bold text-gray-900">{profile.totalTokens.toLocaleString()}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-300" />
                    </div>
                  </Card>
                ))
              ) : (
                <div className="py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <Users className="w-8 h-8 text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-medium">No one has joined the leaderboard yet.</p>
                  <button 
                    onClick={() => setActiveTab('stats')}
                    className="text-violet-600 text-sm font-bold hover:underline"
                  >
                    Be the first to upload stats →
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Instructions */}
        {activeTab === 'stats' && !stats && !error && (
          <div className="mt-12 max-w-2xl mx-auto space-y-6">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
              <h3 className="text-blue-900 font-bold flex items-center gap-2 mb-2">
                <Info className="w-5 h-5" />
                How to get your data?
              </h3>
              <p className="text-blue-800 text-sm leading-relaxed">
                If you use the <strong>Claude Code CLI</strong> by Anthropic, you can view your total token usage costs.
                This tracker helps your team visualize consumption and track spending collectively.
              </p>
              <div className="mt-4 bg-white/50 rounded-xl p-4 font-mono text-xs text-blue-900 space-y-2 border border-blue-100">
                <p># 1. First, install Claude Code CLI:</p>
                <p className="font-bold">npm install -g @anthropic-ai/claude-code</p>
                <p className="mt-2"># 2. Export your stats to JSON:</p>
                <p className="font-bold">claude-code --stats --json {'>'} stats.json</p>
                <p className="mt-2"># 3. Upload the stats.json file here.</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border border-gray-100 bg-white">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-3">
                  <Zap className="w-5 h-5" />
                </div>
                <h4 className="font-bold text-sm mb-1">Local Processing</h4>
                <p className="text-xs text-gray-500">Your data is processed locally first. Cloud sync is optional but recommended for teams.</p>
              </div>
              <div className="p-4 rounded-2xl border border-gray-100 bg-white">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-3">
                  <Trophy className="w-5 h-5" />
                </div>
                <h4 className="font-bold text-sm mb-1">Team Insights</h4>
                <p className="text-xs text-gray-500">Compare usage patterns with your team to share best practices for prompting.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 py-4 bg-white/80 backdrop-blur-sm border-t border-gray-100 text-center">
        <p className="text-xs text-gray-400 font-medium">Built for the Claude Code Community • Multi-User Team Dashboard</p>
      </footer>
    </div>
  );
}

