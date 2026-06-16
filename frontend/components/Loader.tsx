import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoaderProps {
  message?: string;
}

const Loader: React.FC<LoaderProps> = ({ message = "Compiling drug approval data..." }) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
      <p className="text-slate-500 text-sm font-medium animate-pulse">
        {message}
      </p>
    </div>
  );
};

export default Loader;
