'use client';
import { useState } from 'react';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { VersionBadge } from './VersionBadge';
import { TeamAvatars } from './TeamAvatars';
import { LinkIcons } from './LinkIcons';
import { PackageModal } from './PackageModal';
import Image from 'next/image';
import { RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
  completing?: boolean;
  onComplete?: (feature: Feature) => void;
  pinned?: boolean;
}

export function FeatureListItem({ feature, syncing, onEdit, onSync, completing, onComplete, pinned }: Props) {
  const [showPackage, setShowPackage] = useState(false);
  const [showIos, setShowIos] = useState(false);
  return (
    <div className={`bg-[#13162a] border rounded-xl hover:border-[#2e3460] transition-colors
                    sm:col-span-full sm:grid sm:[grid-template-columns:subgrid] sm:items-center
                    ${pinned ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-[#1e2240]'}`}>

      {/* Mobile layout */}
      <div className="sm:hidden px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => onEdit(feature)}
            className="text-white text-sm font-semibold leading-tight text-left hover:text-blue-300 transition-colors cursor-pointer"
          >
            {feature.name}
          </button>
          {feature.meegoUrl && (
            <button onClick={() => onSync(feature)} disabled={syncing} className="text-gray-500 hover:text-blue-400 disabled:opacity-40 shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={feature.status} />
          <VersionBadge version={feature.iosVersion} versionHistory={feature.versionHistory} />
          <PriorityBadge priority={feature.priority} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {feature.meegoUrl && (
            <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#B291F7' }}>
              <Image src="/meego.png" alt="" width={16} height={16} className="shrink-0" /> Meego
            </a>
          )}
          {feature.prd && (
            <a href={feature.prd} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <Image src="/prd.png" alt="" width={14} height={14} className="shrink-0" /> PRD
            </a>
          )}
          {feature.complianceUrl && (
            <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#88DBDD' }}>
              <Image src="/compliance.png" alt="" width={14} height={14} className="shrink-0" /> Compliance
            </a>
          )}
          {feature.figmaUrl && (
            <a href={feature.figmaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#FF7362' }}>
              <Image src="/figma.svg" alt="" width={10} height={14} className="shrink-0" /> Figma
            </a>
          )}
          {feature.abReportUrl && (
            <a href={feature.abReportUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#F59E0B' }}>
              <Image src="/ab.png" alt="" width={14} height={14} className="shrink-0" /> AB
            </a>
          )}
        </div>
        {feature.canCompleteNode && onComplete && (
          <button
            onClick={() => onComplete(feature)}
            disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors self-start"
          >
            {completing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Complete: {feature.status}
          </button>
        )}
      </div>

      {/* Desktop cells — direct subgrid children */}
      <button
        onClick={() => onEdit(feature)}
        className="hidden sm:flex items-center gap-2 pl-4 py-3 w-full min-w-0 text-left text-white text-sm font-semibold hover:text-blue-300 transition-colors cursor-pointer"
      >
        <span className="truncate">{feature.name}</span>
        {pinned && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600/30 text-blue-400 border border-blue-500/40">NEW</span>}
      </button>

      <div className="hidden sm:flex py-3 pl-4">
        <StatusBadge status={feature.status} />
      </div>

      <div className="hidden sm:flex items-center py-3 pl-4">
        <VersionBadge version={feature.iosVersion} versionHistory={feature.versionHistory} />
      </div>

      <div className="hidden sm:flex py-3">
        <PriorityBadge priority={feature.priority} />
      </div>

      <div className="hidden sm:flex items-center py-3 pl-4 overflow-visible relative">
        <LinkIcons feature={feature} ringColor="#13162a" onPackageClick={(ios) => { setShowPackage(true); if (ios) setShowIos(true); }} />
      </div>

      {/* Team avatars */}
      <div className="hidden sm:flex items-center py-3 pl-4">
        <TeamAvatars feature={feature} ringColor="#13162a" />
      </div>

      {/* Comment Summary */}
      <span className="hidden sm:flex items-center py-3 pl-4 text-xs text-gray-400 max-w-[200px] truncate" title={feature.commentSummary}>
        {feature.commentSummary || ''}
      </span>

      {/* Action */}
      <div className="hidden sm:flex items-center pr-4 py-3 pl-4">
        {feature.canCompleteNode && onComplete && (
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(feature); }}
            disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {completing
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle2 className="w-3 h-3" />}
            Complete
          </button>
        )}
      </div>

      {/* Package modal */}
      {showPackage && (feature.packageQrUrl || feature.iosPackageQrUrl) && (
        <PackageModal
          androidQrUrl={feature.packageQrUrl}
          androidDownloadUrl={feature.packageDownloadUrl}
          iosQrUrl={feature.iosPackageQrUrl}
          iosDownloadUrl={feature.iosPackageDownloadUrl}
          featureName={feature.name}
          defaultTab={showIos ? 'ios' : 'android'}
          onClose={() => { setShowPackage(false); setShowIos(false); }}
        />
      )}
    </div>
  );
}
