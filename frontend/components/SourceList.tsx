import React from 'react';
import { Source } from '../types';
import { Link, ExternalLink } from 'lucide-react';

interface SourceListProps {
  sources: Source[];
}

const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mx-4 mt-2 mb-8 bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center space-x-2 mb-3 text-slate-800">
        <Link size={18} className="text-blue-600" />
        <h3 className="text-base font-semibold">Sources & References</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Data sourced directly from official regulatory databases:
      </p>
      <ul className="space-y-3">
        {sources.map((source, index) => (
          <li key={index} className="flex items-start">
            <ExternalLink size={14} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
            <a 
              href={source.uri} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 active:text-blue-800 break-words line-clamp-2"
            >
              {source.title || source.uri}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SourceList;
