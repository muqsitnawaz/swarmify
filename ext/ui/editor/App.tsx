import { useEffect, useState } from 'react';
import Editor from './components/Editor';
import Outline from './components/Outline';
import { Editor as TiptapEditor } from '@tiptap/core';

declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

function App() {
  const [content, setContent] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const [hasActiveAgent, setHasActiveAgent] = useState(false);

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
          console.log('Asset saved:', message.path);
          break;
        case 'agentResult':
          console.log('Agent Result:', message.result);
          break;
        case 'activeAgentChanged':
          setHasActiveAgent(message.hasActiveAgent);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });
    // Check if there's already an active agent for this document
    vscode.postMessage({ type: 'checkActiveAgent' });

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

  const handleSendToAgent = (selection: string) => {
    vscode.postMessage({
      type: 'sendToAgent',
      selection,
    });
  };

  const handleSendToActiveAgent = (selection: string) => {
    vscode.postMessage({
      type: 'sendToActiveAgent',
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

  return (
    <div className="editor-layout">
      <Outline editor={editor} />
      <Editor
        initialContent={content}
        onChange={handleContentChange}
        onSaveAsset={handleSaveAsset}
        onSendToAgent={handleSendToAgent}
        onSendToActiveAgent={handleSendToActiveAgent}
        hasActiveAgent={hasActiveAgent}
        onEditorReady={setEditor}
      />
    </div>
  );
}

export default App;
