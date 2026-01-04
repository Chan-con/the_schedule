import React, { useState, useEffect, useRef, useMemo } from 'react';
import MemoWithLinks from './MemoWithLinks';
import TaskArea from './TaskArea';
import NoteArea from './NoteArea';
import LoopTimelineArea from './LoopTimelineArea';
import QuestArea from './QuestArea';
import { toDateStrLocal } from '../utils/date';

const isSchedulePast = (schedule, selectedDate) => {
	if (!selectedDate) return false;

	const now = new Date();

	if (schedule.allDay) {
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);
		const dateOnly = new Date(selectedDate);
		dateOnly.setHours(0, 0, 0, 0);
		return dateOnly < startOfToday;
	}

	if (!schedule.time) return false;

	const [hours, minutes] = String(schedule.time)
		.split(':')
		.map((value) => Number(value));
	if (Number.isNaN(hours) || Number.isNaN(minutes)) {
		return false;
	}

	const scheduleDateTime = new Date(selectedDate);
	scheduleDateTime.setHours(hours, minutes, 0, 0);

	return scheduleDateTime < now;
};

const shouldDimForTask = (schedule) => {
	if (!schedule?.isTask) return false;
	return !!schedule.completed;
};

const formatTimeLabel = (time) => {
	if (!time) return '時間未設定';
	const [hours = '00', minutes = '00'] = String(time).split(':');
	if (Number.isNaN(Number(hours))) {
		return time;
	}
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getScheduleKey = (schedule, index, prefix) => {
	if (schedule?.id != null) {
		return `${prefix}${schedule.id}`;
	}
	return `${prefix}${index}-${schedule?.name ?? 'schedule'}`;
};

const normalizeQuestPeriod = (value) => {
	const v = String(value || '').trim();
	if (v === 'daily' || v === 'weekly' || v === 'monthly') return v;
	return 'daily';
};

const getQuestCycleId = (period, nowMs) => {
	const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
	const p = normalizeQuestPeriod(period);

	if (p === 'daily') {
		return toDateStrLocal(now);
	}

	if (p === 'weekly') {
		const base = new Date(now);
		base.setHours(0, 0, 0, 0);
		const day = base.getDay(); // 0:Sun ... 6:Sat
		const daysSinceMonday = (day + 6) % 7; // Mon->0, Tue->1, ... Sun->6
		base.setDate(base.getDate() - daysSinceMonday);
		return toDateStrLocal(base);
	}

	// monthly
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	monthStart.setHours(0, 0, 0, 0);
	return toDateStrLocal(monthStart);
};

const Timeline = ({
	schedules = [],
	selectedDate,
	selectedDateStr,
	onEdit,
	onAdd,
	onAddTask,
	onAddNote,
	onClosePanel,
	onUpdateNote,
	onDeleteNote,
	onToggleArchiveNote,
	onToggleImportantNote,
	canShareNotes = false,
	activeNoteId,
	onActiveNoteIdChange,
	onRequestCloseNote,
	onScheduleUpdate,
	onToggleTask,
	onScheduleDelete,
	activeTab = 'timeline',
	onTabChange,
	tasks = [],
	notes = [],
	loopTimelineState,
	loopTimelineMarkers,
	onLoopTimelineSaveState,
	onLoopTimelineAddMarker,
	onLoopTimelineUpdateMarker,
	onLoopTimelineDeleteMarker,
	canShareLoopTimeline = false,
	questTasks = [],
	onCreateQuestTask,
	onToggleQuestTask,
	onUpdateQuestTask,
	onDeleteQuestTask,
	onReorderQuestTasks,
}) => {
	const [draggedAllDayId, setDraggedAllDayId] = useState(null);
	const [allDayDragOverIndex, setAllDayDragOverIndex] = useState(null);
	const [draggedTimeInfo, setDraggedTimeInfo] = useState(null);
	const [timeDragOverInfo, setTimeDragOverInfo] = useState(null);
	const [isMemoHovering, setIsMemoHovering] = useState(false);
	const [isAltPressed, setIsAltPressed] = useState(false);
	const [questNowMs, setQuestNowMs] = useState(() => Date.now());
	const loopTimelineAreaRef = useRef(null);
	const questAreaRef = useRef(null);
	const cardRef = useRef(null);
	const timelineRef = useRef(null);
	const headerRef = useRef(null);

	useEffect(() => {
		const handleKeyDown = (event) => {
			if (event.altKey) {
				setIsAltPressed(true);
			}
		};

		const handleKeyUp = (event) => {
			if (!event.altKey) {
				setIsAltPressed(false);
			}
		};

		const handleBlur = () => {
			setIsAltPressed(false);
		};

		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', handleBlur);
		};
	}, []);

	useEffect(() => {
		const id = window.setInterval(() => setQuestNowMs(Date.now()), 30_000);
		return () => window.clearInterval(id);
	}, []);

	const currentTab = ['timeline', 'tasks', 'notes', 'loop', 'quest'].includes(activeTab) ? activeTab : 'timeline';
	const showTasks = currentTab === 'tasks';
	const showNotes = currentTab === 'notes';
	const showLoopTimeline = currentTab === 'loop';
	const showQuest = currentTab === 'quest';
	const availableTasks = Array.isArray(tasks) ? tasks : [];
	const availableNotes = Array.isArray(notes) ? notes : [];
	const availableQuestTasks = useMemo(() => (Array.isArray(questTasks) ? questTasks : []), [questTasks]);

	const questCycleIds = useMemo(() => {
		return {
			daily: getQuestCycleId('daily', questNowMs),
			weekly: getQuestCycleId('weekly', questNowMs),
			monthly: getQuestCycleId('monthly', questNowMs),
		};
	}, [questNowMs]);

	const questIncompleteTotal = useMemo(() => {
		let count = 0;
		for (const task of availableQuestTasks) {
			const period = normalizeQuestPeriod(task?.period);
			const cycleId = questCycleIds[period];
			const done = String(task?.completed_cycle_id ?? '') === String(cycleId ?? '');
			if (!done) count += 1;
		}
		return count;
	}, [availableQuestTasks, questCycleIds]);

	const timelineEntries = useMemo(() => (Array.isArray(schedules) ? schedules : []), [schedules]);
	const scheduleEntries = useMemo(
		() => timelineEntries.filter((item) => !item?.isTask),
		[timelineEntries]
	);
	const taskEntries = useMemo(
		() => timelineEntries.filter((item) => item?.isTask),
		[timelineEntries]
	);

	const allDaySchedules = useMemo(
		() => scheduleEntries.filter((schedule) => schedule?.allDay),
		[scheduleEntries]
	);
	const allDayTasks = useMemo(
		() => taskEntries.filter((task) => task?.allDay),
		[taskEntries]
	);
	const timeSchedules = useMemo(
		() => scheduleEntries.filter((schedule) => !schedule?.allDay),
		[scheduleEntries]
	);
	const timeTasks = useMemo(
		() => taskEntries.filter((task) => !task?.allDay),
		[taskEntries]
	);

	const sortedAllDayItems = useMemo(() => {
		const combined = [...allDaySchedules, ...allDayTasks];
		return combined.sort((a, b) => {
			if (!!a?.completed !== !!b?.completed) {
				return a.completed ? 1 : -1;
			}
			const orderDiff = (a?.allDayOrder ?? 0) - (b?.allDayOrder ?? 0);
			if (orderDiff !== 0) return orderDiff;
			return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
		});
	}, [allDaySchedules, allDayTasks]);

	const timeBuckets = useMemo(() => {
		const items = [...timeSchedules, ...timeTasks];
		const buckets = new Map();
		for (const schedule of items) {
			const key = schedule?.time ? String(schedule.time) : '';
			if (!buckets.has(key)) {
				buckets.set(key, []);
			}
			buckets.get(key).push(schedule);
		}

		const keys = Array.from(buckets.keys());
		keys.sort((a, b) => {
			if (!a && !b) return 0;
			if (!a) return 1;
			if (!b) return -1;
			return a.localeCompare(b);
		});

		const sorted = keys.map((key) => {
			const bucketItems = buckets.get(key) || [];
			const list = [...bucketItems].sort((a, b) => {
				const orderDiff = (a?.timeOrder ?? 0) - (b?.timeOrder ?? 0);
				if (orderDiff !== 0) return orderDiff;
				if (!!a?.completed !== !!b?.completed) {
					return a.completed ? 1 : -1;
				}
				return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
			});
			return { key, items: list };
		});

		return sorted;
	}, [timeSchedules, timeTasks]);

	const flattenedTimeItems = useMemo(() => {
		const flat = [];
		for (const bucket of timeBuckets) {
			bucket.items.forEach((schedule, indexInBucket) => {
				flat.push({ schedule, timeKey: bucket.key, indexInBucket });
			});
		}
		return flat;
	}, [timeBuckets]);


	const handleAllDayDragStart = (event, schedule) => {
		if (isMemoHovering || !schedule?.id) {
			event.preventDefault();
			return;
		}

		const card = event.currentTarget;
		if (card) {
			card.style.opacity = '0.5';
		}
		setDraggedAllDayId(schedule.id);
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', String(schedule.id));
	};

	const handleAllDayDragEnd = (event) => {
		const card = event.currentTarget;
		if (card) {
			card.style.opacity = '1';
		}
		setDraggedAllDayId(null);
		setAllDayDragOverIndex(null);
	};

	const handleAllDayDragOver = (event, index) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		setAllDayDragOverIndex(index);
	};

	const handleAllDayDragLeave = (event) => {
		if (!event.currentTarget.contains(event.relatedTarget)) {
			setAllDayDragOverIndex(null);
		}
	};

	const handleAllDayDrop = (event, dropIndex) => {
		event.preventDefault();
		setAllDayDragOverIndex(null);

		if (!draggedAllDayId) return;

		const currentOrder = sortedAllDayItems;
		const draggedSchedule = currentOrder.find((schedule) => schedule.id === draggedAllDayId);
		if (!draggedSchedule) {
			setDraggedAllDayId(null);
			return;
		}

		const currentIndex = currentOrder.findIndex((schedule) => schedule.id === draggedAllDayId);
		if (currentIndex === -1) {
			setDraggedAllDayId(null);
			return;
		}

		const nextOrder = [...currentOrder];
		nextOrder.splice(currentIndex, 1);
		const targetIndex = Math.min(dropIndex, nextOrder.length);
		nextOrder.splice(targetIndex, 0, draggedSchedule);

		const updatedSchedules = nextOrder.map((schedule, index) => ({
			...schedule,
			allDayOrder: index,
		}));

		if (onScheduleUpdate) {
			onScheduleUpdate(updatedSchedules, 'schedule_reorder_all_day');
		}

		setDraggedAllDayId(null);
	};

	const handleTimeDragStart = (event, schedule, timeKey) => {
		if (isMemoHovering || !schedule?.id) {
			event.preventDefault();
			return;
		}

		const card = event.currentTarget;
		if (card) {
			card.style.opacity = '0.5';
		}

		setDraggedTimeInfo({ id: schedule.id, timeKey: timeKey ?? '' });
		setTimeDragOverInfo(null);
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', String(schedule.id));
	};

	const handleTimeDragEnd = (event) => {
		const card = event.currentTarget;
		if (card) {
			card.style.opacity = '1';
		}
		setDraggedTimeInfo(null);
		setTimeDragOverInfo(null);
	};

	const handleTimeDragOver = (event, { timeKey, indexInBucket }) => {
		if (!draggedTimeInfo) return;
		if (String(draggedTimeInfo.timeKey ?? '') !== String(timeKey ?? '')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		setTimeDragOverInfo({ timeKey: timeKey ?? '', indexInBucket });
	};

	const handleTimeDragLeave = (event) => {
		if (!event.currentTarget.contains(event.relatedTarget)) {
			setTimeDragOverInfo(null);
		}
	};

	const handleTimeDrop = (event, { timeKey, dropIndexInBucket }) => {
		event.preventDefault();
		setTimeDragOverInfo(null);

		if (!draggedTimeInfo?.id) return;
		if (String(draggedTimeInfo.timeKey ?? '') !== String(timeKey ?? '')) return;

		const bucket = timeBuckets.find((b) => String(b.key ?? '') === String(timeKey ?? ''));
		if (!bucket) {
			setDraggedTimeInfo(null);
			return;
		}

		const currentOrder = bucket.items;
		const currentIndex = currentOrder.findIndex((item) => String(item?.id ?? '') === String(draggedTimeInfo.id));
		if (currentIndex === -1) {
			setDraggedTimeInfo(null);
			return;
		}

		const nextOrder = [...currentOrder];
		const draggedSchedule = nextOrder.splice(currentIndex, 1)[0];
		const targetIndex = Math.max(0, Math.min(dropIndexInBucket, nextOrder.length));
		nextOrder.splice(targetIndex, 0, draggedSchedule);

		const updatedSchedules = nextOrder.map((schedule, index) => ({
			...schedule,
			timeOrder: index,
		}));

		if (onScheduleUpdate) {
			onScheduleUpdate(updatedSchedules, 'schedule_reorder_same_time');
		}

		setDraggedTimeInfo(null);
	};

	const tabs = [
		{
			key: 'timeline',
			label: 'タイムライン',
			icon: (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 6v6l4 2" />
				</svg>
			),
		},
		{
			key: 'tasks',
			label: 'タスク',
			icon: (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" />
					<path d="M9 12l2 2 4-4" />
				</svg>
			),
		},
		{
			key: 'notes',
			label: 'ノート',
			icon: (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<path d="M14 2v6h6" />
					<path d="M16 13H8" />
					<path d="M16 17H8" />
					<path d="M10 9H8" />
				</svg>
			),
		},
		{
			key: 'loop',
			label: 'ループ',
			icon: (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M10 2h4" />
					<path d="M12 14l3-3" />
					<circle cx="12" cy="14" r="8" />
				</svg>
			),
		},
		{
			key: 'quest',
			label: 'クエスト',
			icon: (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					className="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M8 21h8" />
					<path d="M12 17v4" />
					<path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
					<path d="M5 4H3v2a4 4 0 0 0 4 4" />
					<path d="M19 4h2v2a4 4 0 0 1-4 4" />
				</svg>
			),
		},
	];
	const isAddDisabled = showLoopTimeline
		? !(canShareLoopTimeline && typeof onLoopTimelineAddMarker === 'function')
		: showTasks
			? !onAddTask
			: showNotes
				? !onAddNote
				: showQuest
					? false
					: !onAdd;

	const handleAddClick = () => {
		if (showLoopTimeline) {
			loopTimelineAreaRef.current?.openCreate?.();
			return;
		}

		if (showTasks) {
			if (onAddTask) {
				onAddTask();
			}
			return;
		}

		if (showQuest) {
			questAreaRef.current?.openCreate?.();
			return;
		}

		if (showNotes) {
			if (onAddNote) {
				onAddNote();
			}
			return;
		}

		if (onAdd) {
			onAdd();
		}
	};

	const handleTabButtonClick = (key) => {
		if (key === currentTab) return;
		if (onTabChange) {
			onTabChange(key);
		}
	};

	const handleMemoHoverChange = (value) => {
		setIsMemoHovering(Boolean(value));
	};

	const renderAllDayCard = (schedule, index) => {
		const key = getScheduleKey(schedule, index, 'all-day-');
		const isDragged = draggedAllDayId === schedule?.id;
		const isDropTarget = allDayDragOverIndex === index;
		const isPast = isSchedulePast(schedule, selectedDate);
 		const isTaskItem = !!schedule?.isTask;
 		const isCompleted = !!schedule?.completed;

		return (
			<div
				key={key}
				className={`group relative w-full overflow-hidden rounded-lg border border-indigo-100 bg-white p-4 pl-5 text-sm shadow-sm transition-all duration-200 ${
					isDragged ? 'opacity-60 ring-2 ring-indigo-200' : ''
				} ${isDropTarget ? 'ring-2 ring-indigo-300 bg-indigo-50/70' : ''} ${
					shouldDimForTask(schedule) ? 'opacity-60' : ''
				}`}
				draggable={!!schedule?.id}
				onDragStart={(event) => handleAllDayDragStart(event, schedule)}
				onDragEnd={handleAllDayDragEnd}
				onDragOver={(event) => handleAllDayDragOver(event, index)}
				onDragLeave={handleAllDayDragLeave}
				onDrop={(event) => handleAllDayDrop(event, index)}
				onDoubleClick={() => onEdit && onEdit(schedule)}
				onContextMenu={(event) => {
					if (!isAltPressed) return;
					event.preventDefault();
					event.stopPropagation();
					if (onScheduleDelete) {
						onScheduleDelete(schedule);
					}
				}}
			>
				<span className="absolute inset-y-3 left-0 w-1 rounded-full bg-amber-400" aria-hidden="true" />
				<div className="relative ml-3 flex flex-col gap-1">
					<div className="flex items-start justify-between gap-2">
						<div className="flex flex-wrap items-center gap-2">
							{isAltPressed && (
								<span className="mr-1 text-xs" aria-hidden="true">⚡</span>
							)}
							<span
								className={`font-medium ${
									isTaskItem && isCompleted ? 'text-slate-500 line-through' : isPast ? 'text-slate-500' : 'text-slate-900'
								}`}
								title={schedule?.name ? String(schedule.name) : isTaskItem ? '名称未設定のタスク' : '名称未設定の予定'}
							>
								{schedule?.name || '名称未設定の予定'}
							</span>
							{schedule?.allDay && (
								<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
									終日
								</span>
							)}
							{isTaskItem && (
								<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
									タスク
								</span>
							)}
						</div>
						{isTaskItem && onToggleTask && schedule?.id && (
							<button
								type="button"
								className={`inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
									isCompleted
										? 'border-green-500 bg-green-500 text-white'
										: 'border-slate-300 bg-white text-transparent hover:border-slate-400'
								}`}
								title={isCompleted ? '完了済み' : '未完了'}
								onClick={(event) => {
									event.stopPropagation();
									onToggleTask(schedule, !isCompleted);
								}}
							>
								✓
							</button>
						)}
					</div>
					{schedule?.memo && (
						<MemoWithLinks
							memo={schedule.memo}
							className="text-xs leading-relaxed text-slate-600"
							onHoverChange={handleMemoHoverChange}
						/>
					)}
				</div>
			</div>
		);
	};

	const renderTimeCard = (schedule, index, isFirst, isLast) => {
		const key = getScheduleKey(schedule, index, 'time-');
		const timeKey = schedule?.time ? String(schedule.time) : '';
		const isDragged = draggedTimeInfo?.id === schedule?.id;
		const isDropTarget =
			(timeDragOverInfo?.timeKey ?? null) === timeKey &&
			(timeDragOverInfo?.indexInBucket ?? null) === index;
		const isPast = isSchedulePast(schedule, selectedDate);
		const isTaskSchedule = !!schedule?.isTask;
		const isCompleted = !!schedule?.completed;
		const timeLabel = schedule?.allDay ? '終日' : formatTimeLabel(schedule?.time);
		const showTopConnector = !isFirst;
		const showBottomConnector = !isLast;
		const connectorGapPx = 12;

		return (
			<div key={key} className="relative flex items-stretch gap-2">
				<div className="relative flex w-10 flex-col items-center justify-center text-[10px] text-slate-400">
					{showTopConnector && (
						<div
							className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-indigo-100"
							style={{ top: '0.25rem', bottom: `calc(50% + ${connectorGapPx}px)` }}
							aria-hidden="true"
						/>
					)}
					<span className="relative z-10 inline-flex items-center justify-center rounded-full bg-white px-1.5 py-[1px] font-semibold text-indigo-500 tabular-nums shadow-sm">
						{timeLabel}
					</span>
					{showBottomConnector && (
						<div
							className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-indigo-100"
							style={{ top: `calc(50% + ${connectorGapPx}px)`, bottom: '0.25rem' }}
							aria-hidden="true"
						/>
					)}
				</div>
				<div
					className={`relative flex-1 cursor-pointer overflow-hidden rounded-lg border border-indigo-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md ${
						isPast ? 'opacity-80' : ''
					} ${shouldDimForTask(schedule) ? 'opacity-60' : ''} ${
						isDragged ? 'opacity-60 ring-2 ring-indigo-200' : ''
					} ${isDropTarget ? 'ring-2 ring-indigo-300 bg-indigo-50/70' : ''}`}
					draggable={!!schedule?.id}
					onDragStart={(event) => handleTimeDragStart(event, schedule, timeKey)}
					onDragEnd={handleTimeDragEnd}
					onDragOver={(event) => handleTimeDragOver(event, { timeKey, indexInBucket: index })}
					onDragLeave={handleTimeDragLeave}
					onDrop={(event) => handleTimeDrop(event, { timeKey, dropIndexInBucket: index })}
					onDoubleClick={() => onEdit && onEdit(schedule)}
					onContextMenu={(event) => {
						if (!isAltPressed) return;
						event.preventDefault();
						event.stopPropagation();
						if (onScheduleDelete) {
							onScheduleDelete(schedule);
						}
					}}
				>
					<span className="absolute inset-y-3 left-0 w-1 rounded-full bg-indigo-300" aria-hidden="true" />
					<div className="relative ml-2.5 flex flex-wrap items-start gap-3">
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2">
								{isAltPressed && (
									<span className="mr-1 text-xs" aria-hidden="true">⚡</span>
								)}
								<span
									className={`truncate font-medium ${
										isTaskSchedule && isCompleted ? 'line-through text-slate-500' : 'text-slate-900'
									}`}
									title={schedule?.name ? String(schedule.name) : isTaskSchedule ? '名称未設定のタスク' : '名称未設定の予定'}
								>
									{schedule?.name || '名称未設定の予定'}
								</span>
								{schedule?.location && (
									<div className="text-xs text-slate-500">
										{schedule.location}
									</div>
								)}
								{isTaskSchedule && (
									<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
										タスク
									</span>
								)}
							</div>
							{schedule?.memo && (
								<MemoWithLinks
									memo={schedule.memo}
									className="text-xs leading-relaxed text-slate-600"
									onHoverChange={handleMemoHoverChange}
								/>
							)}
						</div>
						{isTaskSchedule && onToggleTask && schedule?.id && (
							<button
								type="button"
								className={`inline-flex size-6 flex-shrink-0 items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
									isCompleted
										? 'border-green-500 bg-green-500 text-white'
										: 'border-slate-300 bg-white text-transparent hover:border-slate-400'
								}`}
								title={isCompleted ? '完了済み' : '未完了'}
								onClick={(event) => {
									event.stopPropagation();
									onToggleTask(schedule, !isCompleted);
								}}
							>
								✓
							</button>
						)}
					</div>
				</div>
			</div>
		);
	};

	const renderTimelineSection = () => (
		<div className="flex-1 min-h-0">
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex-1 min-h-0">
					<div className="custom-scrollbar h-full overflow-y-auto px-4 pb-[18px]">
						<div className="py-4">
							{sortedAllDayItems.length > 0 && (
								<div className="pb-6">
									<div className="flex items-center gap-3 pb-3 text-[11px] font-semibold text-slate-400">
										<span className="h-px flex-1 bg-slate-200" />
										<span className="tracking-wide">終日</span>
										<span className="h-px flex-1 bg-slate-200" />
									</div>
									<div className="card-stack">
										{sortedAllDayItems.map((item, index) => renderAllDayCard(item, index))}
										{draggedAllDayId && (
											<div
												className={`h-12 rounded-lg border-2 border-dashed transition-colors duration-200 ${
													allDayDragOverIndex === sortedAllDayItems.length
														? 'border-indigo-300 bg-indigo-50/60'
														: 'border-transparent'
												}`}
												onDragOver={(event) => handleAllDayDragOver(event, sortedAllDayItems.length)}
												onDragLeave={handleAllDayDragLeave}
												onDrop={(event) => handleAllDayDrop(event, sortedAllDayItems.length)}
											>
												<span className="sr-only">ここにドロップして末尾に移動</span>
											</div>
										)}
									</div>
								</div>
							)}

							<div className="flex items-center gap-3 pb-3 text-[11px] font-semibold text-slate-400">
								<span className="h-px flex-1 bg-slate-200" />
								<span className="tracking-wide">時間指定</span>
								<span className="h-px flex-1 bg-slate-200" />
							</div>

							{flattenedTimeItems.length === 0 ? (
								<div className="flex min-h-[calc(100%-2rem)] flex-col items-center justify-center gap-2 text-slate-400">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="h-12 w-12 text-slate-200"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth="1.5"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
									<span className="text-sm">時間付きの予定はありません</span>
									<span className="text-xs text-slate-300">「＋」ボタンから予定を追加できます</span>
								</div>
							) : (
								<div className="card-stack pb-2">
									{timeBuckets.map((bucket) => (
										<React.Fragment key={bucket.key || 'no-time'}>
											{bucket.items.map((schedule, indexInBucket) => {
												const overallIndex = flattenedTimeItems.findIndex((entry) => entry.schedule?.id === schedule?.id);
												const isFirst = overallIndex === 0;
												const isLast = overallIndex === flattenedTimeItems.length - 1;
												return renderTimeCard(schedule, indexInBucket, isFirst, isLast);
											})}
											{draggedTimeInfo && String(draggedTimeInfo.timeKey ?? '') === String(bucket.key ?? '') && (
												<div
													className={`h-12 rounded-lg border-2 border-dashed transition-colors duration-200 ${
														(timeDragOverInfo?.timeKey ?? null) === String(bucket.key ?? '') &&
														(timeDragOverInfo?.indexInBucket ?? null) === bucket.items.length
															? 'border-indigo-300 bg-indigo-50/60'
															: 'border-transparent'
													}`}
													onDragOver={(event) => handleTimeDragOver(event, { timeKey: bucket.key, indexInBucket: bucket.items.length })}
													onDragLeave={handleTimeDragLeave}
													onDrop={(event) => handleTimeDrop(event, { timeKey: bucket.key, dropIndexInBucket: bucket.items.length })}
												>
													<span className="sr-only">ここにドロップして末尾に移動</span>
												</div>
											)}
										</React.Fragment>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	return (
		<div
			ref={cardRef}
			className="flex h-full min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-xl"
		>
			<header ref={headerRef} className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 rounded-t-lg">
				<div className="flex flex-wrap items-center gap-3">
					<div className="inline-flex items-center rounded-full bg-slate-100 p-1">
						{tabs.map((tab) => {
							const isActive = currentTab === tab.key;
							const showQuestBadge = tab.key === 'quest' && questIncompleteTotal > 0;
							return (
								<button
									key={tab.key}
									type="button"
									onClick={() => handleTabButtonClick(tab.key)}
									className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent p-1 transition-all duration-200 focus:outline-none focus-visible:outline-none active:outline-none active:bg-transparent active:text-indigo-600 hover:border-transparent ${
										isActive
											? 'bg-white text-indigo-600 shadow'
											: 'bg-transparent text-slate-500 hover:text-indigo-500'
									}`}
									aria-pressed={isActive}
									aria-label={tab.label}
									title={tab.label}
								>
									<span className="relative inline-flex" aria-hidden="true">
										{tab.icon}
										{showQuestBadge && (
											<span className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
												{questIncompleteTotal > 99 ? '99+' : questIncompleteTotal}
											</span>
										)}
									</span>
									<span className="sr-only">{tab.label}</span>
								</button>
							);
						})}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 transition-all duration-200 ${
							isAddDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-indigo-50 hover:shadow'
						}`}
						onClick={handleAddClick}
						disabled={isAddDisabled}
						title={showTasks ? 'タスクを追加' : showNotes ? 'ノートを追加' : showLoopTimeline ? '追加項目を追加' : showQuest ? 'クエストを追加' : '予定を追加'}
					>
						<span className="text-lg font-semibold leading-none">＋</span>
					</button>
					{typeof onClosePanel === 'function' && (
						<button
							type="button"
							className="inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 transition-all duration-200 hover:bg-indigo-50 hover:shadow"
							onClick={onClosePanel}
							title="閉じる"
							aria-label="閉じる"
						>
							<span className="text-lg font-semibold leading-none">×</span>
						</button>
					)}
				</div>
			</header>

			<div className="flex-1 min-h-0 overflow-hidden">
				{showTasks ? (
					<TaskArea
						tasks={availableTasks}
						onEdit={onEdit}
						onToggleTask={onToggleTask}
						onTaskDelete={onScheduleDelete}
						isAltPressed={isAltPressed}
					/>
				) : showNotes ? (
					<NoteArea
						notes={availableNotes}
						onUpdateNote={onUpdateNote}
						onDeleteNote={onDeleteNote}
						onToggleArchiveNote={onToggleArchiveNote}
						onToggleImportantNote={onToggleImportantNote}
						canShare={canShareNotes}
						isAltPressed={isAltPressed}
						selectedDateStr={selectedDateStr}
						activeNoteId={activeNoteId}
						onActiveNoteIdChange={onActiveNoteIdChange}
						onRequestClose={onRequestCloseNote}
					/>
				) : showQuest ? (
					<QuestArea
						ref={questAreaRef}
						tasks={availableQuestTasks}
						onCreateTask={onCreateQuestTask}
						onToggleTask={onToggleQuestTask}
						onUpdateTask={onUpdateQuestTask}
						onDeleteTask={onDeleteQuestTask}
						onReorderTasks={onReorderQuestTasks}
					/>
				) : showLoopTimeline ? (
					<LoopTimelineArea
						ref={loopTimelineAreaRef}
						canShare={canShareLoopTimeline}
						state={loopTimelineState}
						markers={loopTimelineMarkers}
						onSaveState={onLoopTimelineSaveState}
						onAddMarker={onLoopTimelineAddMarker}
						onUpdateMarker={onLoopTimelineUpdateMarker}
						onDeleteMarker={onLoopTimelineDeleteMarker}
					/>
				) : (
					<div
						ref={timelineRef}
						className="flex h-full min-h-0 flex-col overflow-hidden rounded-b-lg bg-slate-100/70"
					>
						{renderTimelineSection()}
					</div>
				)}
			</div>
		</div>
	);
};

export default Timeline;
