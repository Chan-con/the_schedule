import React from 'react';

const QuickMemoPad = ({ value, onChange, className = '', textareaClassName = '' }) => {
  const handleChange = (event) => {
    if (onChange) {
      onChange(event.target.value);
    }
  };

  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-md border border-indigo-900/20 bg-white/95 p-3 shadow-xl shadow-indigo-900/30 backdrop-blur ${className}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-indigo-900">Memo</h3>
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder="思いついたことを書き留めておけます"
        className={`custom-scrollbar flex-1 resize-none overflow-auto rounded border border-indigo-900/20 bg-white/90 px-2 py-2 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-400 min-h-0 ${textareaClassName}`}
      />
    </section>
  );
};

export default QuickMemoPad;
