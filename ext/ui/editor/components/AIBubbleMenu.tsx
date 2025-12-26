import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import { Play } from 'lucide-react';

interface AIBubbleMenuProps {
  editor: Editor;
  onSendToAgent: (selection: string) => void;
}

function AIBubbleMenu({ editor, onSendToAgent }: AIBubbleMenuProps) {
  const getSelectedText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
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
        onClick={handleSendToAgent}
        className="ai-menu-button"
        title="Open new agent with selection as context"
      >
        <Play size={16} />
        <span>New Agent</span>
      </button>
    </TiptapBubbleMenu>
  );
}

export default AIBubbleMenu;
