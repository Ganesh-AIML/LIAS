import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrueTime } from '../hooks/useTrueTime'; 
import { useAuthStore } from '../store/authStore';
import api, { violationApi } from '../services/api';
import {
  User, Lock, Clock, Calendar, CheckCircle,
  XCircle, PlayCircle, LogOut, X, Activity, BookOpen, KeyRound,
  BrainCircuit, Database, Code2, RefreshCw, AlertTriangle
} from 'lucide-react';

const LiveCountdown = ({ rawDate, duration, isUpcoming, ts }) => {
  const [timeLeft, setTimeLeft] = useState('...'); 

  useEffect(() => {
    if (!rawDate || !ts) return; 

    const startTimeMs = new Date(rawDate).getTime();
    const endTimeMs = isUpcoming ? startTimeMs : startTimeMs + (parseInt(duration) || 0) * 60000;

    const updateTimer = () => {
      const now = ts.now();
      const diff = endTimeMs - now;

      if (diff <= 0) {
        setTimeLeft(isUpcoming ? 'Starting Soon...' : 'Exam Ended');
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 60000) % 60);
        const s = Math.floor((diff / 1000) % 60);

        if (days > 0) setTimeLeft(`${days}d ${hours}h ${m}m`);
        else if (hours > 0) setTimeLeft(`${hours}h ${m}m ${s}s`);
        else setTimeLeft(`${m}m ${s < 10 ? '0' : ''}${s}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [rawDate, duration, isUpcoming, ts]); 

  return <span className={isUpcoming ? "text-indigo-600 font-black tracking-wide" : "text-red-600 font-black tracking-wide"}>{timeLeft}</span>;
};

export default function StudentDashboard() {
  const navigate = useNavigate();
  const clearSession = useAuthStore((state) => state.clearSession);
  
const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
useEffect(() => {
  const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
  document.addEventListener('fullscreenchange', handleFs);
  return () => document.removeEventListener('fullscreenchange', handleFs);
}, []);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState(null);
  const [startPasswordInput, setStartPasswordInput] = useState('');
  const [startPasswordError, setStartPasswordError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [studentProfile, setStudentProfile] = useState(null);
  const [liveExams, setLiveExams] = useState([]);
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [pastExams, setPastExams] = useState([]);
  const [loading, setLoading] = useState(true);

  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dashboardHeartbeatRef = useRef(null);

  // 🛡️ THE FIX: Create a stable reference to ts
  const { ts, isSynced } = useTrueTime();
  const tsRef = useRef(ts);
  
  useEffect(() => { 
    tsRef.current = ts; 
  }, [ts]);

  const [rawAvailableTests, setRawAvailableTests] = useState([]);
  const [rawPastResults, setRawPastResults] = useState([]);

  useEffect(() => {
    const fetchExams = async () => {
      try {
        const response = await api.get('/exam/student/available-tests');
        const { profile, availableTests, pastResults } = response.data.data || response.data;
        setStudentProfile(profile);
        setRawAvailableTests(availableTests || []);
        setRawPastResults(pastResults || []);
      } catch (error) {
        console.error("Error loading student dashboard:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchExams();
  }, []); 

  // 🛡️ THE FIX: Removed 'ts' from dependency array to permanently kill the loop
  useEffect(() => {
    if (!isSynced || !tsRef.current || !rawAvailableTests) return;

    const updateDashboardBuckets = () => {
      const nowMs = tsRef.current.now(); 
      const live = [];
      const upcoming = [];
      const missed = [];

      rawAvailableTests.forEach(test => {
        const startTimeMs = new Date(test.date).getTime();
        const endTimeMs = startTimeMs + ((test.duration || 120) * 60000);

        if (nowMs < startTimeMs) {
          upcoming.push(test);
        } else if (nowMs >= startTimeMs && nowMs <= endTimeMs) {
          live.push(test);
        } else {
          missed.push({
            id: test.id, testId: test.id, title: test.title, date: test.date,
            isMissed: true, status: 'Not Attempted'
          });
        }
      });

      setLiveExams(live);
      setUpcomingExams(upcoming);

      const combinedPast = [...rawPastResults, ...missed].sort((a, b) => {
        const dateA = new Date(a.submittedAt || a.date).getTime();
        const dateB = new Date(b.submittedAt || b.date).getTime();
        return dateB - dateA;
      });

      setPastExams(combinedPast);
    };

    updateDashboardBuckets();

    // Issue 26: store interval in ref so manual refresh can reset it
    dashboardHeartbeatRef.current = setInterval(updateDashboardBuckets, 60000);

    return () => clearInterval(dashboardHeartbeatRef.current);

  }, [isSynced, rawAvailableTests, rawPastResults]); // <--- 'ts' is gone from here

  const handleStudentRefresh = async () => {
    // Issue 26: reset the 60s polling interval so it doesn't fire right after a manual refresh
    if (dashboardHeartbeatRef.current) {
      clearInterval(dashboardHeartbeatRef.current);
      dashboardHeartbeatRef.current = setInterval(() => {
        api.get('/exam/student/available-tests')
          .then(response => {
            const { availableTests, pastResults } = response.data.data || response.data;
            setRawAvailableTests(availableTests || []);
            setRawPastResults(pastResults || []);
          })
          .catch(err => console.error('[heartbeat] refresh failed:', err));
      }, 60000);
    }
    setIsRefreshing(true);
    try {
      const response = await api.get('/exam/student/available-tests');
      const { profile, availableTests, pastResults } = response.data.data || response.data;
      setStudentProfile(profile);
      setRawAvailableTests(availableTests || []);
      setRawPastResults(pastResults || []);
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = () => {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('scope_')) {
        localStorage.removeItem(key);
      }
    });
    clearSession();
    navigate('/');
  };

  const handleUpdatePassword = async () => {
    if (!passwords.current || !passwords.new || !passwords.confirm) return alert("Please fill in all password fields.");
    if (passwords.new !== passwords.confirm) return alert("New passwords do not match.");
    if (passwords.new.length < 6) return alert("Your new password must be at least 6 characters long.");

    try {
      setIsUpdating(true);
      await api.put('/auth/update-password', { currentPassword: passwords.current, newPassword: passwords.new });
      alert("Success! Your password has been updated securely.");
      setPasswords({ current: '', new: '', confirm: '' }); 
      setIsProfileOpen(false); 
    } catch (error) {
      alert(error.response?.data?.detail || "Failed to update password.");
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 font-bold">Loading your assessments...</div>;

  const name = studentProfile?.name || "Student User";
  const rollNo = studentProfile?.studentProfile?.rollNo || "N/A";
  const branch = studentProfile?.studentProfile?.branch || "General Course";
  const batch = studentProfile?.studentProfile?.batch || "N/A";

  const handleInitiateExam = (testId) => {
    setSelectedTestId(testId);
    setShowStartModal(true);
    setStartPasswordInput('');
    setStartPasswordError('');
  };

  const confirmStartExam = async () => {
    setIsVerifying(true);
    setStartPasswordError('');
    try {
      await api.post(`/exam/${selectedTestId}/verify-password`, { type: 'start', password: startPasswordInput });
      setShowStartModal(false);
      navigate(`/workspace/${selectedTestId}`);
    } catch (error) {
      setStartPasswordError(error.response?.data?.detail || "Incorrect Start Password");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-[#1E293B] pb-12">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue-900 rounded-md flex items-center justify-center"><Activity size={17} className="text-white" /></div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">LIAS</h1>
                <span className="text-xs font-bold text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 leading-none">Student</span>
                {liveExams.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    {liveExams.length} Live
                  </span>
                )}
              </div>
            </div>

            <button onClick={() => setIsProfileOpen(true)} className="flex items-center gap-3 hover:bg-slate-50 p-2 rounded-lg transition-colors border border-transparent hover:border-slate-200">
              <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-slate-900 leading-tight">{name}</p>
                <p className="text-xs text-slate-500 font-medium">{rollNo} · {branch}</p>
              </div>
              <div className="h-9 w-9 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-900"><User size={18} /></div>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-sm font-bold text-slate-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            {liveExams.length} Live
          </span>
          <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-sm font-bold text-slate-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            {upcomingExams.length} Upcoming
          </span>
          <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-4 py-1.5 text-sm font-bold text-slate-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            {pastExams.filter(e => !(e.isMissed || e.status === 'Not Attempted')).length} Completed
          </span>
        </div>
        {!isFullscreen && (
          <div className="flex items-center justify-between bg-white border border-amber-200 rounded-xl px-5 py-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Fullscreen Recommended</p>
                <p className="text-xs text-slate-500 font-medium">Fullscreen will be enforced automatically when you enter an exam.</p>
              </div>
            </div>
            <button
              onClick={() => document.documentElement.requestFullscreen().catch(() => {})}
              className="text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg whitespace-nowrap ml-4 transition-colors"
            >
              Enable Now
            </button>
          </div>
        )}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></div>
              <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Live Examinations</h2>
            </div>
            
            <button 
              onClick={handleStudentRefresh} disabled={isRefreshing}
              className="flex items-center gap-2 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin text-slate-500" : ""} />
              {isRefreshing ? 'Syncing...' : 'Refresh Status'}
            </button>
          </div>

          {liveExams.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {liveExams.map(exam => (
                <div key={exam.id} className="bg-white border-2 border-blue-900 rounded-xl p-6 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">

                  <div className="flex-1 z-10">
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">{exam.title}</h3>
                    <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-600">
                      <span className="flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded font-mono">
                        <Clock size={14} className="animate-pulse" /> 
                       <LiveCountdown rawDate={exam.date} duration={exam.duration} isUpcoming={false} ts={ts} /> remaining
                      </span>
                      <span className="flex items-center gap-1.5"><BookOpen size={16} className="text-indigo-600" /> Exam ID: {exam.id.slice(-5)}</span>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assessment Structure</p>
                      <div className="flex flex-wrap gap-2">
                        {exam.sections?.map((sec, idx) => (
                          <span key={sec.id || idx} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${sec.category === 'Technical' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                            {sec.category === 'Technical' ? <Database size={12} /> : <BrainCircuit size={12} />}
                            {sec.name}
                          </span>
                        ))}
                        {exam.codingProblems?.length > 0 && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            <Code2 size={12} /> Coding Problems ({exam.codingProblems.length})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button onClick={() => handleInitiateExam(exam.id)} className="flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-8 rounded-lg transition-all active:scale-95 shadow-md whitespace-nowrap z-10">
                    <PlayCircle size={20} /> Enter Exam Environment
                  </button>
                </div>
              ))}
            </div>
          ) : upcomingExams.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Activity size={14} /> Next Up
                </p>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{upcomingExams[0].title}</h3>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /> {new Date(upcomingExams[0].date).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> {new Date(upcomingExams[0].date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-5 py-3 text-center shrink-0">
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Starts In</p>
                <p className="text-xl"><LiveCountdown rawDate={upcomingExams[0].date} isUpcoming={true} ts={ts} /></p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 font-medium">No live or upcoming exams at the moment.</div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide mb-4">Upcoming Schedule</h2>
          {upcomingExams.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {upcomingExams.map(exam => (
                <div key={exam.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-slate-900 mb-3">{exam.title}</h3>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <span className="flex items-center gap-2"><Calendar size={16} className="text-slate-400" /> {new Date(exam.date).toLocaleDateString()}</span>
                      <span className="font-semibold text-slate-800">{new Date(exam.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <span className="flex items-center gap-2"><Clock size={16} className="text-slate-400" /> {exam.duration} Mins</span>
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded">Scheduled</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm text-slate-600 border-t border-slate-100 pt-3 mt-3">
                      <span className="flex items-center gap-2 font-bold"><Activity size={16} className="text-indigo-500" /> Starts in:</span>
                      <span className="bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded font-mono text-sm"><LiveCountdown rawDate={exam.date} isUpcoming={true} ts={ts} />
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl py-12 flex flex-col items-center gap-2 text-slate-400">
              <Calendar size={28} className="text-slate-300" />
              <p className="font-medium">No upcoming assessments scheduled.</p>
              <p className="text-xs">New exams will appear here once scheduled.</p>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">Past Results</h2>
            {pastExams.length > 0 && (
              <span className="text-xs font-bold text-slate-400">{pastExams.length} record{pastExams.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-500 tracking-wider">
                  <tr><th className="px-6 py-4">Examination Title</th><th className="px-6 py-4">Date Taken</th><th className="px-6 py-4 text-center">Score</th><th className="px-6 py-4 text-right">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pastExams.length > 0 ? pastExams.map((exam, index) => {
                    const examId = exam.testId || exam.id;
                    const examTitle = exam.test?.title || exam.title || "Completed Assessment";
                    const examDate = exam.submittedAt || exam.date;
                    const formattedDate = examDate ? new Date(examDate).toLocaleDateString() : "N/A";
                    const examScore = exam.totalScore ?? exam.score ?? 0;
                    
                    const isScoreVisible = exam.showScore === true || String(exam.showScore).toLowerCase() === 'true';
                    const isMissed = exam.isMissed || exam.status === 'Not Attempted';

                    return (
                      <tr key={examId || index} className={`transition-colors ${isMissed ? 'bg-red-50/30' : 'hover:bg-slate-50'}`}>
                        <td className="px-6 py-4">
                          {isMissed ? (
                            <span className="font-bold text-slate-500">{examTitle}</span>
                          ) : (
                            <span className="font-bold text-slate-900">{examTitle}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-medium">{formattedDate}</td>
                        <td className="px-6 py-4 text-center font-black">
                          {isMissed ? (
                            <span className="text-slate-300">--</span>
                          ) : isScoreVisible ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{examScore} Pts</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-slate-100 text-slate-400 text-[10px] uppercase tracking-wider font-bold">Hidden</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {isMissed ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                              <XCircle size={12} /> Missed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle size={12} /> Submitted
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan="4" className="px-6 py-16">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <BookOpen size={28} className="text-slate-300" />
                        <p className="font-medium">No past assessment records yet.</p>
                        <p className="text-xs">Completed exams will appear here.</p>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>



      {/* SECURE PROFILE SETTINGS — SLIDE-OVER */}
      {isProfileOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsProfileOpen(false)}></div>
          <div className="relative z-10 ml-auto h-full w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden" style={{animation:'slideInRight 0.22s cubic-bezier(0.22,1,0.36,1)'}}>
            <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Account Settings</h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Manage your profile & credentials</p>
              </div>
              <button onClick={() => setIsProfileOpen(false)} className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-lg transition-colors"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-blue-900 flex items-center justify-center text-white font-bold shrink-0">{name.split(' ').filter(Boolean).map(w => w[0]).slice(0,2).join('').toUpperCase()}</div>
                <div>
                  <p className="font-bold text-slate-900">{name}</p>
                  <p className="text-xs text-slate-500 font-medium">{rollNo} · {branch} · Batch {batch}</p>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Update Security Credentials</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Current Password</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3 top-3 text-slate-400" />
                    <input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:border-blue-900 focus:ring-2 focus:ring-blue-50 outline-none transition-all"/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">New Password</label>
                  <div className="relative">
                    <KeyRound size={15} className="absolute left-3 top-3 text-slate-400" />
                    <input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:border-blue-900 focus:ring-2 focus:ring-blue-50 outline-none transition-all"/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Confirm New Password</label>
                  <div className="relative">
                    <KeyRound size={15} className="absolute left-3 top-3 text-slate-400" />
                    <input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:border-blue-900 focus:ring-2 focus:ring-blue-50 outline-none transition-all"/>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
              <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 font-bold text-sm hover:text-red-700 transition-colors"><LogOut size={15} /> Sign Out</button>
              <button onClick={handleUpdatePassword} disabled={isUpdating} className="bg-blue-900 hover:bg-blue-800 text-white text-sm font-bold py-2.5 px-6 rounded-lg disabled:opacity-50 transition-colors">{isUpdating ? 'Updating...' : 'Update Password'}</button>
            </div>
          </div>
        </div>
      )}

      {/* START EXAM MODAL */}
      {showStartModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-4">
              <Lock size={22} className="text-blue-900" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Secure Exam Entry</h2>
            <p className="text-sm text-slate-500 mb-6">Please enter the Start Password provided by your invigilator.</p>
            <input type="password" value={startPasswordInput} onChange={(e) => setStartPasswordInput(e.target.value)} className={`w-full p-3 rounded-lg border-2 mb-2 outline-none ${startPasswordError ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-slate-500'}`}/>
            {startPasswordError && <p className="text-sm text-red-500 font-bold mb-4">{startPasswordError}</p>}
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowStartModal(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={confirmStartExam} disabled={isVerifying || !startPasswordInput} className="px-6 py-2 bg-blue-900 hover:bg-blue-800 text-white font-bold rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors">{isVerifying ? 'Verifying...' : 'Enter Exam'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}