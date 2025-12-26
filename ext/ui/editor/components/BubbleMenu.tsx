import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link as LinkIcon,
  Highlighter,
} from 'lucide-react';

interface BubbleMenuProps {
  editor: Editor;
}

function BubbleMenu({ editor }: BubbleMenuProps) {
  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100 }}
      className="bubble-menu"
    >
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
        title="Bold"
      >
        <Bold size={16} />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
        title="Italic"
      >
        <Italic size={16} />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'is-active' : ''}
        title="Strikethrough"
      >
        <Strikethrough size={16} />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={editor.isActive('code') ? 'is-active' : ''}
        title="Code"
      >
        <Code size={16} />
      </button>

      <div className="separator" />

      <button
        onClick={setLink}
        className={editor.isActive('link') ? 'is-active' : ''}
        title="Link"
      >
        <LinkIcon size={16} />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={editor.isActive('highlight') ? 'is-active' : ''}
        title="Highlight"
      >
        <Highlighter size={16} />
      </button>
    </TiptapBubbleMenu>
  );
}

export default BubbleMenu;
