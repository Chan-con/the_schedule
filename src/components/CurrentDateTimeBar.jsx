import React, { useEffect, useState } from 'react';

const CurrentDateTimeBar = ({ selectedDate }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const ymd = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const weekday = now.toLocaleDateString('ja-JP', { weekday: 'long' });
  const time = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const sameDay = selectedDate && now.toDateString() === selectedDate.toDateString();

  return (
    <div className="flex items-center justify-between mb-2 pb-2 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-md px-3 py-2 flex-shrink-0">
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-indigo-600 tracking-wide">CURRENT</span>
        <span className="text-sm font-bold text-gray-800 leading-tight">{ymd}（{weekday}）</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-lg font-semibold text-indigo-700 tabular-nums">{time}</span>
      </div>
    </div>
  );
};

export default CurrentDateTimeBar;
