import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { 
  User, Briefcase, ChevronDown, LogOut, Mail, BadgeCheck,
  Lock, Key, X // 🛡️ Added security icons
} from 'lucide-react';

import { API_BASE_URL } from "../../services/api";
import { useTrueTime } from '../../hooks/useTrueTime'; // 🚀 ADD THIS


const TnpMainView = lazy(() => import('./TnpViews/TnpMainView'));
const TnpAnalyticsView = lazy(() => import('./TnpViews/TnpAnalyticsView'));
const ScheduleTest = lazy(() => import('./TnpViews/ScheduleTest'));
const UpcomingTestPreview = lazy(() => import('./TnpViews/UpcomingTestPreview'));
const LiveTestMonitor = lazy(() => import('./TnpViews/LiveTestMonitor'));

export default function TnpDashboard() {
  const navigate = useNavigate();

  const [adminProfile, setAdminProfile] = useState(null);
  const [selectedTest, setSelectedTest] = useState(null);
  const [selectedUpcomingTest, setSelectedUpcomingTest] = useState(null);
  const [selectedLiveTest, setSelectedLiveTest] = useState(null);

  const [isCreatingTest, setIsCreatingTest] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [liveTests, setLiveTests] = useState([]);
  const [upcomingTests, setUpcomingTests] = useState([]);
  const [draftTests, setDraftTests] = useState([]);
  const [pastTests, setPastTests] = useState([]);

  const [rawTests, setRawTests] = useState([]);

const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [isUpdating, setIsUpdating] = useState(false);

  // 🚀 1. Bring in the Secure Clock
  const { ts, isSynced } = useTrueTime();

  useEffect(() => {
    const userStr = localStorage.getItem('scope_user');
    if (userStr) setAdminProfile(JSON.parse(userStr));
  }, []);

  // 🚀 2. Extracted fetch function (Now relies on Secure Server Time)
  // 🚀 JOB 1: Just fetch the raw data once. No math!
  const fetchAllTests = async () => {
    if (!isSynced || !ts) return; 

    try {
      const response = await fetch(`${API_BASE_URL}/api/tnp/all-tests`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const result = await response.json();

      if (result.success) {
        setRawTests(result.data); // Save it directly to the raw state
      }
    } catch (error) {
      console.error("Network Error:", error);
    }
  };


  // 🚀 3. Trigger the fetch automatically ONLY when the clock finishes syncing
  useEffect(() => {
    fetchAllTests();
  }, [isSynced, ts]);

  // 🚀 JOB 2: The Heartbeat! Updates the UI every minute locally
  useEffect(() => {
    // Wait until we have the data and the secure clock
    if (!isSynced || !ts || rawTests.length === 0) return;

    const updateDashboardTime = () => {
      const currentTime = ts.now(); 
      const live = [];
      const upcoming = [];
      const past = [];
      const drafts = [];

      rawTests.forEach(test => {
        // Use rawDate if we already saved it, otherwise use the original date
        const startDate = new Date(test.rawDate || test.date).getTime();
        const durationMs = (test.duration || 120) * 60000;
        const endDate = startDate + durationMs;

        // Create a fresh copy for the UI
        const displayTest = { ...test };
        displayTest.rawDate = test.rawDate || test.date; 
        displayTest.date = new Date(startDate).toLocaleDateString();
        
        // Calculate the live remaining time
        displayTest.timeRemaining = currentTime < endDate 
          ? Math.max(0, Math.round((endDate - currentTime) / 60000)) + " Min" 
          : "0 Min";

        // Sort them into the correct buckets based on the current secure time
        if (displayTest.status === 'Draft') drafts.push(displayTest);
        else if (currentTime > endDate) past.push(displayTest);
        else if (currentTime >= startDate && currentTime <= endDate) live.push(displayTest);
        else upcoming.push(displayTest);
      });

      // Update the UI
      setPastTests(past);
      setLiveTests(live);
      setUpcomingTests(upcoming);
      setDraftTests(drafts);
    };

    // Run it instantly to populate the screen
    updateDashboardTime();

    // Set up the loop to re-calculate every 60 seconds
    const heartbeat = setInterval(updateDashboardTime, 60000);

    return () => clearInterval(heartbeat);
  }, [isSynced, ts, rawTests]);

  // 🛡️ NEW FUNCTION: Handle Password Update
  const handleUpdatePassword = async () => {
    if (!passwords.current || !passwords.new || !passwords.confirm) {
      return alert("Please fill out all password fields.");
    }
    if (passwords.new !== passwords.confirm) {
      return alert("New passwords do not match. Please try again.");
    }
    try {
      setIsUpdating(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/tnp/update-password`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.new })
      });
      
      const data = await response.json();
      if (response.ok && data.success) {
        alert("Password updated securely!");
        setPasswords({ current: '', new: '' });
        setIsProfileOpen(false);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (error) {
      console.error("Update Password Error:", error);
      alert("Network error updating password.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePublishTest = async (newTest) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/tnp/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(newTest),
      });

      const result = await response.json();

      if (result.success) {
        alert("Test successfully scheduled!");
        setIsCreatingTest(false); // Close the creator
        fetchAllTests(); // 🚀 Quietly pull the fresh data from the DB without refreshing the page!
      } else {
        alert("Error saving test: " + (result.error || result.message));
      }
    } catch (error) {
      console.error("Publish Error:", error); // 🛡️ Fix: Now using the error variable
      alert("Failed to connect to the server.");
    }
  };

  const handleSaveDraft = async (draftData) => {
    try {
      // 1. Send the massive draft package to your backend Upsert route
      const response = await fetch(`${API_BASE_URL}/api/tnp/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(draftData),
      });

      const result = await response.json();

      if (result.success) {
        // 2. If the database saved it successfully, update the UI
        alert("Draft saved securely to the database!");
        
        // Use the official DB response (which has the real UUID) to update local state
    
        setIsCreatingTest(false);
        setEditingDraft(null);
        fetchAllTests();
        
        // Optional: Force a refresh to pull the absolute latest list from DB
      } else {
        alert("Error saving draft: " + (result.error || result.message));
      }
    } catch (error) {
      console.error("Draft Save Error:", error);
      alert("Failed to connect to the server while saving draft.");
    }
  };

  const handleResumeDraft = async (draftShallow) => {
    try {
      // 🛡️ THE FIX: Fetch the FULL test data from the DB before opening the editor!
      const response = await fetch(`${API_BASE_URL}/api/tnp/test/${draftShallow.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const result = await response.json();

      if (result.success) {
        setEditingDraft(result.data); // Now we pass all the sections and questions!
        setIsCreatingTest(true);
      } else {
        alert("Failed to load full draft details.");
      }
    } catch (error) {
      console.error("Fetch Draft Error:", error);
      alert("Network error while loading draft.");
    }
  };

  const handleEditClick = () => {
    setEditingDraft(selectedUpcomingTest); 
    setSelectedUpcomingTest(null);
    setIsCreatingTest(true);
  };

  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('scope_user');
    navigate('/');
  };

  const handleDeleteTest = async (testId, category) => {
    if (!window.confirm("Are you sure you want to archive this test?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/tnp/test/${testId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const result = await response.json();
      
      if (result.success) {
        // 🚀 THE FIX: Instead of manually editing the sub-arrays, just re-fetch!
        // This updates rawTests, which instantly triggers the heartbeat to re-sort the UI correctly.
        fetchAllTests();
      }
    } catch (error) {
      console.error("Delete Error:", error); 
      alert("Failed to connect to the server.");
    }
  };

  const handleViewTestDetails = async (testShallow) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/tnp/test/${testShallow.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const result = await response.json();
      if (result.success) setSelectedUpcomingTest(result.data); 
    } catch (error) {
      console.error("Fetch Details Error:", error); // 🛡️ Fix
      alert("Failed to fetch test details.");
    }
  };

  const adminName = adminProfile?.name || "T&P Administrator";
  const adminEmail = adminProfile?.email || "admin@scope.edu";
  const adminDesignation = adminProfile?.staffProfile?.designation || "Head of T&P Cell";

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-12">

      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-900 rounded-md flex items-center justify-center">
                <Briefcase size={18} className="text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                S.C.O.P.E. <span className="text-blue-900">T&P Admin</span>
              </h1>
            </div>

            <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-3 hover:bg-slate-50 p-2 rounded-xl transition-colors outline-none"
              >
                <div className="text-right hidden md:block">
                  <p className="text-sm font-bold text-slate-900 leading-tight">{adminName}</p>
                  <p className="text-xs text-slate-500 font-medium">{adminDesignation}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-900">
                    <User size={20} />
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* 🛡️ THE NEW UPGRADED SECURITY MODAL */}
              {isProfileOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsProfileOpen(false)}></div>
                  
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center justify-between p-6 border-b border-slate-100">
                      <h2 className="text-xl font-bold text-slate-900">T&P Admin Profile</h2>
                      <button onClick={() => setIsProfileOpen(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                        <X size={20} />
                      </button>
                    </div>

                    <div className="p-6">
                      <div className="flex items-center gap-4 mb-6">
                        <div className="h-16 w-16 rounded-full bg-blue-100 border-2 border-blue-200 flex items-center justify-center text-blue-900 flex-shrink-0">
                          <User size={32} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 text-lg">{adminName}</h3>
                          <p className="text-sm text-slate-500 flex items-center gap-1.5"><Mail size={14}/> {adminEmail}</p>
                          <div className="mt-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <BadgeCheck size={12} /> SYSTEM ADMIN
                            </span>
                          </div>
                        </div>
                      </div>

                      <hr className="border-slate-100 mb-6" />

                      <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Lock size={16} className="text-blue-900" /> Security Settings
                      </h4>
                      
                      <div className="space-y-3">
                        {/* 1. CURRENT PASSWORD */}
                        <div className="relative">
                          <Lock size={16} className="absolute left-3 top-3 text-slate-400" />
                          <input 
                            type="password" 
                            value={passwords.current}
                            onChange={(e) => setPasswords({...passwords, current: e.target.value})}
                            placeholder="Current password" 
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900 text-sm" 
                          />
                        </div>
                        {/* 2. NEW PASSWORD */}
                        <div className="relative">
                          <Key size={16} className="absolute left-3 top-3 text-slate-400" />
                          <input 
                            type="password" 
                            value={passwords.new}
                            onChange={(e) => setPasswords({...passwords, new: e.target.value})}
                            placeholder="New strong password" 
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900 text-sm" 
                          />
                        </div>
                        {/* 3. CONFIRM PASSWORD */}
                        <div className="relative">
                          <Key size={16} className="absolute left-3 top-3 text-slate-400" />
                          <input 
                            type="password" 
                            value={passwords.confirm}
                            onChange={(e) => setPasswords({...passwords, confirm: e.target.value})}
                            placeholder="Confirm new password" 
                            className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900 text-sm" 
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                      <button onClick={handleSignOut} className="flex items-center gap-2 text-red-600 hover:text-red-800 text-sm font-bold transition-colors">
                        <LogOut size={16} /> Sign Out
                      </button>
                      
                      <button 
                        onClick={handleUpdatePassword}
                        disabled={isUpdating}
                        className={`bg-blue-900 hover:bg-blue-800 text-white text-sm font-bold py-2.5 px-5 rounded-lg transition-all shadow-sm ${isUpdating ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        {isUpdating ? 'Updating...' : 'Save Password'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading System...</div>}>
        {isCreatingTest ? (
          <ScheduleTest 
            initialData={editingDraft}
            onBack={() => { setIsCreatingTest(false); setEditingDraft(null); }} 
            onPublish={handlePublishTest} 
            onSaveDraft={handleSaveDraft}
          />
        ) : selectedLiveTest ? (
          <LiveTestMonitor test={selectedLiveTest} onBack={() => setSelectedLiveTest(null)} />
        ) : selectedUpcomingTest ? (
          <UpcomingTestPreview test={selectedUpcomingTest} onBack={() => setSelectedUpcomingTest(null)} onEdit={handleEditClick} />
        ) : selectedTest ? (
          <TnpAnalyticsView selectedTest={selectedTest} setSelectedTest={setSelectedTest} />
        ) : (
          <TnpMainView 
            setSelectedTest={setSelectedTest} onScheduleClick={() => setIsCreatingTest(true)} onViewUpcoming={handleViewTestDetails}
            onResumeDraft={handleResumeDraft} onMonitorLive={(test) => setSelectedLiveTest(test)} onDeleteTest={handleDeleteTest}
            pastTests={pastTests} liveTests={liveTests} upcomingTests={upcomingTests} draftTests={draftTests} 
            ts={ts} // 🚀 ADD THIS PROP TO FIX THE TIMER
          />
        )}
        </Suspense>
      </main>
    </div>
  );
}
