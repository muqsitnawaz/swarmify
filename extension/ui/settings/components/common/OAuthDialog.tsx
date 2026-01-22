import { useState } from 'react';

interface OauthDialogProps {
  provider: 'linear' | 'github';
  onAuthComplete: () => void;
  onClose: () => void;
}

export function OauthDialog({ provider, onAuthComplete, onClose }: OauthDialogProps) {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');

  const handleOAuthStart = async () => {
    setStatus('waiting');
    try {
      const result = await vscode.postMessage({
        type: 'startOAuth',
        provider
      });
      
      if (result.error) {
        setStatus('error');
        return;
      }

      const pollInterval = setInterval(async () => {
        try {
          const checkResult = await vscode.postMessage({
            type: 'checkOAuthStatus',
            provider
          });
          
          if (checkResult.token) {
            clearInterval(pollInterval);
            setStatus('success');
            onAuthComplete();
          }
        } catch (err) {
          console.error('[OAUTH] Polling error:', err);
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(pollInterval);
        if (status !== 'success') {
          setStatus('idle');
        }
      }, 120000);
    } catch (err) {
      console.error('[OAUTH] Start error:', err);
      setStatus('error');
    }
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
