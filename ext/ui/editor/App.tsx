import { useEffect, useState, useRef } from 'react';
import Editor, { EditorRef } from './components/Editor';
import Outline from './components/Outline';

declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

function App() {
  const [content, setContent] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [aiResult, setAIResult] = useState<{ action: string; result: string } | null>(null);
  const editorRef = useRef<EditorRef>(null);

  useEffect(() => {
    // Handle messages from extension
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          setContent(message.content);
          setIsReady(true);
          break;
        case 'assetSaved':
          // Asset saved successfully, path is in message.path
          console.log('Asset saved:', message.path);
          break;
        case 'aiResult':
          // AI action completed
          setAIResult({ action: message.action, result: message.result });
          console.log('AI Result:', message.result);
          break;
        case 'agentResult':
          // Agent action completed
          console.log('Agent Result:', message.result);
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    // Signal that webview is ready
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    vscode.postMessage({
      type: 'update',
      content: newContent,
    });
  };

  const handleSaveAsset = (data: string, fileName: string) => {
    vscode.postMessage({
      type: 'saveAsset',
      data,
      fileName,
    });
  };

  const handleAIAction = (action: string, selection: string) => {
    vscode.postMessage({
      type: 'aiAction',
      action,
      selection,
    });
  };

  const handleSendToAgent = (selection: string) => {
    vscode.postMessage({
      type: 'sendToAgent',
      selection,
    });
  };

  if (!isReady) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '14px',
        color: 'var(--vscode-foreground)'
      }}>
        Loading editor...
      </div>
    );
  }

  const editor = editorRef.current?.getEditor() ?? null;

  return (
    <div className="editor-layout">
      <Outline editor={editor} />
      <Editor
        ref={editorRef}
        initialContent={content}
        onChange={handleContentChange}
        onSaveAsset={handleSaveAsset}
        onAIAction={handleAIAction}
        onSendToAgent={handleSendToAgent}
        aiResult={aiResult}
      />
    </div>
  );
}

export default App;
