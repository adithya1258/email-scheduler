'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';

export interface RichTextHandle {
  getHTML: () => string;
  getText: () => string;
  clear: () => void;
}

type Cmd = { icon: React.ComponentType<{ className?: string }>; label: string; run: () => void };

/**
 * Lightweight WYSIWYG editor (contentEditable + execCommand). Enough for
 * outreach emails without pulling in a full editor framework.
 */
export const RichTextEditor = forwardRef<RichTextHandle, { placeholder?: string }>(function RichTextEditor(
  { placeholder },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getHTML: () => el.current?.innerHTML ?? '',
    getText: () => el.current?.innerText.trim() ?? '',
    clear: () => {
      if (el.current) el.current.innerHTML = '';
    },
  }));

  const exec = (command: string, value?: string) => () => {
    el.current?.focus();
    document.execCommand(command, false, value);
  };

  const groups: Cmd[][] = [
    [
      { icon: Undo2, label: 'Undo', run: exec('undo') },
      { icon: Redo2, label: 'Redo', run: exec('redo') },
    ],
    [
      {
        icon: Type,
        label: 'Heading',
        run: () => {
          el.current?.focus();
          const current = document.queryCommandValue('formatBlock').toLowerCase();
          document.execCommand('formatBlock', false, current === 'h3' ? 'p' : 'h3');
        },
      },
      { icon: Bold, label: 'Bold', run: exec('bold') },
      { icon: Italic, label: 'Italic', run: exec('italic') },
      { icon: Underline, label: 'Underline', run: exec('underline') },
    ],
    [
      { icon: AlignLeft, label: 'Align left', run: exec('justifyLeft') },
      { icon: AlignCenter, label: 'Align center', run: exec('justifyCenter') },
      { icon: AlignRight, label: 'Align right', run: exec('justifyRight') },
    ],
    [
      { icon: List, label: 'Bulleted list', run: exec('insertUnorderedList') },
      { icon: ListOrdered, label: 'Numbered list', run: exec('insertOrderedList') },
      { icon: Quote, label: 'Quote', run: exec('formatBlock', 'blockquote') },
      { icon: Strikethrough, label: 'Strikethrough', run: exec('strikeThrough') },
      {
        icon: Link2,
        label: 'Link',
        run: () => {
          const url = window.prompt('Link URL');
          if (url) exec('createLink', url)();
        },
      },
      { icon: RemoveFormatting, label: 'Clear formatting', run: exec('removeFormat') },
    ],
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-white px-2 py-1.5">
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-center gap-0.5 border-r border-line pr-1 last:border-r-0">
            {g.map(({ icon: Icon, label, run }) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()} // keep the text selection
                onClick={run}
                className="rounded-md p-1.5 text-gray-600 hover:bg-surface hover:text-ink"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        ))}
      </div>
      <div
        ref={el}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className="email-body min-h-[260px] px-4 py-3 text-sm leading-relaxed outline-none [&_h3]:text-base [&_h3]:font-semibold"
      />
    </div>
  );
});
