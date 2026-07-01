import React, { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';

const InstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    // Check if the app is already running in standalone mode
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(isStandaloneMode);

    // Check if the device is iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    // Listen for the beforeinstallprompt event (supported on macOS Chrome/Edge, Android, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Don't show the button if already installed, or if it's not installable (not iOS and no prompt)
  if (isStandalone) return null;
  if (!deferredPrompt && !isIOS) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Show the native install prompt (macOS Chrome/Edge)
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      // Show custom instructions for iOS Safari
      setShowIOSPrompt(true);
    }
  };

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="p-2 text-blue-600 hover:bg-blue-50 active:bg-blue-100 rounded-full transition-colors flex items-center"
        aria-label="Install App"
        title="Install App"
      >
        <Download size={20} />
      </button>

      {/* iOS Installation Instructions Modal */}
      {showIOSPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300">
            <button
              onClick={() => setShowIOSPrompt(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full"
            >
              <X size={18} />
            </button>
            
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
              <Download size={24} />
            </div>
            
            <h3 className="text-xl font-bold text-slate-900 mb-2">Install DrugRadar</h3>
            <p className="text-slate-600 text-sm mb-6 leading-relaxed">
              Install this app on your iPhone's home screen for quick, full-screen access to the live database.
            </p>
            
            <ol className="text-sm text-slate-700 space-y-4 mb-8">
              <li className="flex items-center bg-slate-50 p-3 rounded-xl">
                <span className="w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center mr-3 font-bold text-blue-600 text-xs shrink-0">1</span>
                <span>Tap the <Share size={18} className="inline mx-1 text-blue-500" /> <strong>Share</strong> button at the bottom of your screen.</span>
              </li>
              <li className="flex items-center bg-slate-50 p-3 rounded-xl">
                <span className="w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center mr-3 font-bold text-blue-600 text-xs shrink-0">2</span>
                <span>Scroll down and tap <strong className="mx-1">Add to Home Screen</strong> <PlusSquare size={18} className="inline ml-1 text-slate-500" />.</span>
              </li>
            </ol>
            
            <button
              onClick={() => setShowIOSPrompt(false)}
              className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallButton;
