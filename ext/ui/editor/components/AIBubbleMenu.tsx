import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import {
  Sparkles,
  ArrowRight,
  Wand2,
  AlignLeft,
  CheckCircle,
  Play,
} from 'lucide-react';

interface AIBubbleMenuProps {
  editor: Editor;
  onAIAction: (action: string, selection: string) => void;
  onSendToAgent: (selection: string) => void;
}

function AIBubbleMenu({ editor, onAIAction, onSendToAgent }: AIBubbleMenuProps) {
  const getSelectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
  };

  const handleAIAction = (action: string) => {
    const selection = getSelectedText();
    if (selection) {
      onAIAction(action, selection);
    }
  };

  const handleSendToAgent = () => {
    const selection = getSelectedText();
    if (selection) {
      onSendToAgent(selection);
    }
  };

  // Only show when text is selected
  const shouldShow = ({ editor }: { editor: Editor }) => {
    const { from, to } = editor.state.selection;
    return from !== to;
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100, placement: 'top' }}
      shouldShow={shouldShow}
      className="ai-bubble-menu"
    >
      <button
        onClick={() => handleAIAction('improve')}
        className="ai-menu-button"
        title="Improve writing"
      >
        <Wand2 size={16} />
        <span>Improve</span>
      </button>

      <button
        onClick={() => handleAIAction('expand')}
        className="ai-menu-button"
        title="Expand on idea"
      >
        <ArrowRight size={16} />
        <span>Expand</span>
      </button>

      <button
        onClick={() => handleAIAction('summarize')}
        className="ai-menu-button"
        title="Summarize selection"
      >
        <AlignLeft size={16} />
        <span>Summarize</span>
      </button>

      <button
        onClick={() => handleAIAction('fix')}
        className="ai-menu-button"
        title="Fix grammar & spelling"
      >
        <CheckCircle size={16} />
        <span>Fix</span>
      </button>

      <button
        onClick={() => handleAIAction('continue')}
        className="ai-menu-button"
        title="Continue writing"
      >
        <Sparkles size={16} />
        <span>Continue</span>
      </button>

      <button
        onClick={handleSendToAgent}
        className="ai-menu-button task-button"
        title="Send to Agent as task"
      >
        <Play size={16} />
        <span>Task</span>
      </button>
    </TiptapBubbleMenu>
  );
}

export default AIBubbleMenu;
