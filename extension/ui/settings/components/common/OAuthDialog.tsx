import { useState, useEffect, useRef } from 'react';
import { postMessage } from '../../hooks';

interface OauthDialogProps {
  provider: 'linear' | 'github';
  onAuthComplete: () => void;
  onClose: () => void;
}

export function OauthDialog({ provider, onAuthComplete, onClose }: OauthDialogProps) {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'oauthStarted' && message.provider === provider) {
        // OAuth URL opened successfully, start polling
        pollIntervalRef.current = setInterval(() => {
          postMessage({ type: 'checkOAuthStatus', provider });
        }, 1000);

        // Timeout after 120 seconds
        setTimeout(() => {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          if (status === 'waiting') {
            setStatus('error');
          }
        }, 120000);
      } else if (message.type === 'oauthToken' && message.provider === provider) {
        if (message.token) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatus('success');
          onAuthComplete();
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [provider, onAuthComplete]);

  const handleOAuthStart = () => {
    setStatus('waiting');
    postMessage({ type: 'startOAuth', provider });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Connect {provider}</h2>
        
        {status === 'idle' && (
          <button
            onClick={handleOAuthStart}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Connect with {provider}
          </button>
        )}
        
        {status === 'waiting' && (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent border-t-blue-600" />
            <span className="text-sm text-gray-600">
              {provider === 'linear' 
                ? 'Waiting for Linear authorization...' 
                : 'Waiting for GitHub authorization...'}
            </span>
          </div>
        )}
        
        {status === 'success' && (
          <div className="text-green-600 text-sm font-medium">
            Connected! You can close this dialog.
          </div>
        )}
        
        {status === 'error' && (
          <div className="text-red-600 text-sm mb-4">
            Authorization failed. Please try again.
          </div>
        )}
        
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 mt-4"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
