import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Download, Share, PlusSquare, X, MoreVertical } from 'lucide-react';

const APP_STORE_URL = 'https://apps.apple.com/app/drugradar/id6784735764';

type Platform = 'ios' | 'mac-safari' | 'other';

const detectPlatform = (): Platform => {
  const ua = window.navigator.userAgent.toLowerCase();
  // iPadOS reports a Mac user agent; touch support tells the two apart.
  const isIPad = ua.includes('macintosh') && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || isIPad) return 'ios';
  const isSafari = ua.includes('safari') && !/chrome|chromium|crios|edg|firefox|fxios|opr/.test(ua);
  if (ua.includes('macintosh') && isSafari) return 'mac-safari';
  return 'other';
};

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex items-center bg-slate-50 p-3 rounded-xl">
    <span className="w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center mr-3 font-bold text-blue-600 text-xs shrink-0">{n}</span>
    <span>{children}</span>
  </li>
);

const InstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(Boolean(isStandaloneMode));
    setPlatform(detectPlatform());

    // Chrome/Edge (desktop and Android) offer their own install dialog.
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  // The App Store app is already installed, and a home-screen web app too.
  if (Capacitor.isNativePlatform() || isStandalone) return null;

  const handleInstallClick = async () => {
    // A browser install prompt can only be shown once; later taps get the help dialog.
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      setDeferredPrompt(null);
      try {
        await prompt.prompt();
        return;
      } catch {
        // fall through to the manual instructions
      }
    }
    setShowHelp(true);
  };

  const apple = platform === 'ios' || platform === 'mac-safari';

  // Rendered into <body>: the header's backdrop blur would otherwise trap the
  // full-screen overlay inside the header strip.
  const dialog = showHelp && createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Install the app"
      onClick={() => setShowHelp(false)}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300 max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={() => setShowHelp(false)}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
          <Download size={24} />
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-2">Install DrugRadar</h3>

        {apple && (
          <>
            <p className="text-slate-600 text-sm mb-3 leading-relaxed">
              The easiest way on iPhone, iPad and Mac is the free app from the App Store.
            </p>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 mb-5 bg-slate-900 text-white text-center font-semibold rounded-xl active:bg-slate-700 transition-colors"
            >
              Get it on the App Store
            </a>
            <p className="text-slate-600 text-sm mb-3 leading-relaxed">
              Or keep this web version as an app icon:
            </p>
          </>
        )}

        {!apple && (
          <p className="text-slate-600 text-sm mb-4 leading-relaxed">
            Add this web app to your device for quick, full-screen access:
          </p>
        )}

        <ol className="text-sm text-slate-700 space-y-3 mb-6">
          {platform === 'ios' && (
            <>
              <Step n={1}>Open this page in <strong>Safari</strong> and tap the <Share size={18} className="inline mx-1 text-blue-500" /> <strong>Share</strong> button.</Step>
              <Step n={2}>Tap <strong className="mx-1">Add to Home Screen</strong> <PlusSquare size={18} className="inline ml-1 text-slate-500" /> (scroll down if you don't see it).</Step>
            </>
          )}
          {platform === 'mac-safari' && (
            <>
              <Step n={1}>In the menu bar choose <strong>File</strong>.</Step>
              <Step n={2}>Click <strong>Add to Dock…</strong>, then <strong>Add</strong>.</Step>
            </>
          )}
          {platform === 'other' && (
            <>
              <Step n={1}>Open the browser menu <MoreVertical size={16} className="inline mx-1 text-slate-500" /> (or the install icon in the address bar).</Step>
              <Step n={2}>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</Step>
            </>
          )}
        </ol>

        <button
          onClick={() => setShowHelp(false)}
          className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body
  );

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
      {dialog}
    </>
  );
};

export default InstallButton;
