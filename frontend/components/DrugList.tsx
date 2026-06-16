import React from 'react';
import { Drug, DrugDetailData } from '../types';
import { Building2, Pill, Activity, Calendar, Globe, FileText } from 'lucide-react';

interface DrugListProps {
  drugs: Drug[];
  onSelect: (data: DrugDetailData) => void;
}

const toDetail = (drug: Drug): DrugDetailData => ({
  brandName: drug.brandName,
  genericName: drug.genericName,
  approvalDate: drug.fdaApprovalDate,
  indication: drug.indication,
  drugClass: drug.drugClass,
  company: drug.company,
  emaApprovalDate: drug.emaApprovalDate,
  emaUrl: drug.emaUrl,
  badge: drug.is351k ? '351(k) Biosimilar' : undefined,
});

const DrugList: React.FC<DrugListProps> = ({ drugs, onSelect }) => {
  if (drugs.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <Pill className="text-slate-400 w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-1">No results found</h3>
        <p className="text-slate-500 text-sm">Try adjusting your search terms.</p>
      </div>
    );
  }

  const getStatusColor = (dateStr: string) => {
    if (dateStr.toLowerCase().includes('pending')) return 'text-amber-700 bg-amber-50 border-amber-200';
    if (dateStr.toLowerCase().includes('not approved')) return 'text-red-700 bg-red-50 border-red-200';
    return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  };

  return (
    <div className="space-y-4 px-4 pb-6">
      {drugs.map((drug) => (
        <button
          key={drug.id}
          type="button"
          onClick={() => onSelect(toDetail(drug))}
          className="block w-full text-left bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden active:scale-[0.98] transition-transform duration-200"
        >
          {/* Card Header */}
          <div className="p-4 border-b border-slate-100 flex justify-between items-start">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 shrink-0">
                <Pill size={22} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg leading-tight">{drug.brandName}</h3>
                <p className="text-sm text-slate-500 font-medium mt-0.5">{drug.genericName}</p>
                {drug.is351k && (
                  <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
                    351(k) Biosimilar
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {/* Card Body */}
          <div className="p-4 space-y-3 bg-slate-50/30">
            <div className="flex items-start text-sm text-slate-700">
              <Activity size={18} className="mr-2.5 mt-0.5 text-slate-400 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Indication</span>
                <span className="leading-snug">{drug.indication || 'Not listed in FDA labeling'}</span>
              </div>
            </div>
            {drug.drugClass && (
              <div className="flex items-start text-sm text-slate-700">
                <Pill size={18} className="mr-2.5 mt-0.5 text-slate-400 shrink-0" />
                <div>
                  <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Drug Class</span>
                  <span className="leading-snug">{drug.drugClass}</span>
                </div>
              </div>
            )}
            <div className="flex items-start text-sm text-slate-700">
              <Building2 size={18} className="mr-2.5 mt-0.5 text-slate-400 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Company</span>
                <span className="leading-snug">{drug.company}</span>
              </div>
            </div>
          </div>
          
          {/* Card Footer (Dates) */}
          <div className="p-4 border-t border-slate-100 grid grid-cols-2 gap-3 bg-white">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 flex items-center">
                <Calendar size={12} className="mr-1"/> FDA Approval
              </p>
              <div className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold w-full justify-center ${getStatusColor(drug.fdaApprovalDate)}`}>
                {drug.fdaApprovalDate}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 flex items-center">
                <Globe size={12} className="mr-1"/> EMA Approval
              </p>
              <div className={`inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold w-full justify-center ${
                /^\d/.test(drug.emaApprovalDate)
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                  : 'text-slate-500 bg-slate-50 border-slate-200'
              }`}>
                {drug.emaApprovalDate}
              </div>
            </div>
          </div>

          {/* 351(k) biosimilar approval (FDA does not publish pending applications) */}
          {drug.is351k && drug.applicationDate351k && drug.applicationDate351k !== 'N/A' && (
            <div className="px-4 pb-4 pt-1 bg-white">
              <div className="pt-3 border-t border-slate-100">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5 flex items-center">
                  <FileText size={12} className="mr-1"/> 351(k) Biosimilar — FDA Approved
                </p>
                <div className="inline-flex items-center px-2.5 py-1.5 rounded-lg border text-xs font-semibold w-full justify-center text-indigo-700 bg-indigo-50 border-indigo-200">
                  {drug.applicationDate351k}
                </div>
              </div>
            </div>
          )}
        </button>
      ))}
    </div>
  );
};

export default DrugList;
