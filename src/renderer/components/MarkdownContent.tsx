import ReactMarkdown from 'react-markdown';
import { chatMarkdownComponents, chatMarkdownRemarkPlugins } from '@renderer/lib/chatMarkdown';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        components={chatMarkdownComponents}
        remarkPlugins={chatMarkdownRemarkPlugins}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
