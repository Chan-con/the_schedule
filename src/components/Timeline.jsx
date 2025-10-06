import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import MemoWithLinks from './MemoWithLinks';
import TaskArea from './TaskArea';

const ALL_DAY_MIN_HEIGHT = 120;
const TIMELINE_MIN_HEIGHT = 120;
const VIEWPORT_PADDING = 8;
const CARD_BOTTOM_MARGIN = 0;
const RESIZE_HANDLE_HEIGHT = 12;

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

const Timeline = ({
	schedules = [],
	selectedDate,
	onEdit,
	onAdd,
	onAddTask,
	onScheduleUpdate,
	onToggleTask,
	activeTab = 'timeline',
	onTabChange,
	tasks = [],
}) => {
	const [draggedAllDayId, setDraggedAllDayId] = useState(null);
	const [dragOverIndex, setDragOverIndex] = useState(null);
	const [allDayHeight, setAllDayHeight] = useState(200);
	const [heightLoaded, setHeightLoaded] = useState(false);
	const [isResizing, setIsResizing] = useState(false);
	const [resizeStartY, setResizeStartY] = useState(0);
	const [resizeStartHeight, setResizeStartHeight] = useState(0);
	const [isMemoHovering, setIsMemoHovering] = useState(false);
	const [cardMaxHeight, setCardMaxHeight] = useState(null);
	const cardRef = useRef(null);
	const timelineRef = useRef(null);
	const allDaySectionRef = useRef(null);
	const headerRef = useRef(null);
	const resizeLimitsRef = useRef({ maxHeight: ALL_DAY_MIN_HEIGHT });

	const computeAllDayMaxHeight = useCallback(
		(fallback = 600) => {
			const minHeight = ALL_DAY_MIN_HEIGHT;
			const headerHeight = headerRef.current?.offsetHeight ?? 0;
			const effectiveCardMax = cardMaxHeight ?? fallback;
			const structuralReserve = headerHeight + TIMELINE_MIN_HEIGHT + RESIZE_HANDLE_HEIGHT;
			const limit = effectiveCardMax - structuralReserve;
			return Math.max(minHeight, limit);
		},
		[cardMaxHeight]
	);

	const currentTab = activeTab === 'tasks' ? 'tasks' : 'timeline';
	const showTimeline = currentTab === 'timeline';
	const showTasks = currentTab === 'tasks';
	const availableTasks = Array.isArray(tasks) ? tasks : [];

	useLayoutEffect(() => {
		if (!showTimeline) return undefined;
		if (typeof window === 'undefined') return undefined;

		let frame = null;
		const measure = () => {
			const cardEl = cardRef.current;
			if (!cardEl) return;
			const cardRect = cardEl.getBoundingClientRect();
			const viewportAvailable = window.innerHeight - cardRect.top - VIEWPORT_PADDING - CARD_BOTTOM_MARGIN;
			const parentEl = cardEl.parentElement;
			const parentAvailable = parentEl ? parentEl.clientHeight - CARD_BOTTOM_MARGIN : Number.POSITIVE_INFINITY;
			const candidates = [viewportAvailable, parentAvailable].filter((value) => Number.isFinite(value) && value > 0);
			if (!candidates.length) return;
			const headerHeight = headerRef.current?.offsetHeight ?? 0;
			const minimumCardHeight = headerHeight + ALL_DAY_MIN_HEIGHT + TIMELINE_MIN_HEIGHT + RESIZE_HANDLE_HEIGHT;
			const nextMax = Math.max(minimumCardHeight, Math.min(...candidates));
			setCardMaxHeight(nextMax);
		};

		const update = () => {
			if (frame) {
				cancelAnimationFrame(frame);
			}
			frame = requestAnimationFrame(measure);
		};

		update();
		window.addEventListener('resize', update);

		const cardEl = cardRef.current;
		const parentEl = cardEl?.parentElement;
		let resizeObserver;
		if (parentEl && typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(update);
			resizeObserver.observe(parentEl);
		}

		return () => {
			window.removeEventListener('resize', update);
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			if (frame) {
				cancelAnimationFrame(frame);
			}
		};
	}, [showTimeline]);

	useEffect(() => {
		if (typeof window === 'undefined' || !showTimeline) return undefined;
		let frame = null;
		const handleResize = () => {
			if (frame) {
				cancelAnimationFrame(frame);
			}
			frame = requestAnimationFrame(() => {
				setAllDayHeight((previous) => {
					if (isResizing) {
						return previous;
					}
					const maxHeight = computeAllDayMaxHeight(previous);
					return Math.min(Math.max(ALL_DAY_MIN_HEIGHT, previous), maxHeight);
				});
			});
		};

		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('resize', handleResize);
			if (frame) {
				cancelAnimationFrame(frame);
			}
		};
	}, [computeAllDayMaxHeight, isResizing, showTimeline]);

	useEffect(() => {
		if (!showTimeline || isResizing) return;
		const maxHeight = computeAllDayMaxHeight(allDayHeight);
		if (allDayHeight > maxHeight) {
			setAllDayHeight(maxHeight);
		}
	}, [allDayHeight, computeAllDayMaxHeight, isResizing, showTimeline]);

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

	const sortedAllDaySchedules = useMemo(() => {
		return [...allDaySchedules].sort((a, b) => {
			const orderDiff = (a?.allDayOrder ?? 0) - (b?.allDayOrder ?? 0);
			if (orderDiff !== 0) return orderDiff;
			return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
		});
	}, [allDaySchedules]);

	const sortedAllDayTasks = useMemo(() => {
		return [...allDayTasks].sort((a, b) => {
			if (!!a?.completed !== !!b?.completed) {
				return a.completed ? 1 : -1;
			}
			const orderDiff = (a?.allDayOrder ?? 0) - (b?.allDayOrder ?? 0);
			if (orderDiff !== 0) return orderDiff;
			return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
		});
	}, [allDayTasks]);

	const sortedTimeItems = useMemo(() => {
		const allItems = [...timeSchedules, ...timeTasks];
		return allItems.sort((a, b) => {
			const aTime = a?.time || '';
			const bTime = b?.time || '';
			if (!aTime && !bTime) {
				if (!!a?.completed !== !!b?.completed) {
					return a.completed ? 1 : -1;
				}
				if (!!a?.isTask !== !!b?.isTask) {
					return a.isTask ? 1 : -1;
				}
				return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
			}
			if (!aTime) return 1;
			if (!bTime) return -1;
			if (aTime !== bTime) return aTime.localeCompare(bTime);
			if (!!a?.isTask !== !!b?.isTask) {
				return a.isTask ? 1 : -1;
			}
			if (!!a?.completed !== !!b?.completed) {
				return a.completed ? 1 : -1;
			}
			return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
		});
	}, [timeSchedules, timeTasks]);

	useEffect(() => {
		const handleMouseMove = (event) => {
			if (!isResizing) return;

			const maxHeight = resizeLimitsRef.current?.maxHeight ?? computeAllDayMaxHeight();
			const deltaY = event.clientY - resizeStartY;
			const candidateHeight = resizeStartHeight + deltaY;
			const clampedHeight = Math.max(
				ALL_DAY_MIN_HEIGHT,
				Math.min(maxHeight, candidateHeight)
			);
			setAllDayHeight(clampedHeight);
		};

		const handleMouseUp = () => {
			setIsResizing(false);
		};

		if (isResizing) {
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			document.body.style.userSelect = 'none';
		}

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
			document.body.style.userSelect = '';
		};
	}, [computeAllDayMaxHeight, isResizing, resizeStartY, resizeStartHeight]);

	const handleResizeStart = (event) => {
		event.preventDefault();
		setIsResizing(true);
		setResizeStartY(event.clientY);
		setResizeStartHeight(allDayHeight);
		resizeLimitsRef.current = {
			maxHeight: computeAllDayMaxHeight(),
		};
	};

	useLayoutEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				if (window.electronAPI) {
					const settings = await window.electronAPI.getSettings();
					if (!mounted) return;
					const value = typeof settings.allDayHeight === 'number' ? settings.allDayHeight : 200;
					const dynamicMax = computeAllDayMaxHeight();
					const clamped = Math.min(Math.max(value, ALL_DAY_MIN_HEIGHT), dynamicMax);
					setAllDayHeight(clamped);
					setHeightLoaded(true);
				} else {
					const stored = localStorage.getItem('allDayHeight');
					if (!stored) {
						setHeightLoaded(true);
						return;
					}
					const raw = parseInt(stored, 10);
					if (!Number.isNaN(raw)) {
						const dynamicMax = computeAllDayMaxHeight();
						const clamped = Math.min(Math.max(raw, ALL_DAY_MIN_HEIGHT), dynamicMax);
						setAllDayHeight(clamped);
					}
					setHeightLoaded(true);
				}
			} catch (error) {
				console.warn('終日エリア高さの読み込みに失敗:', error);
				setHeightLoaded(true);
			}
		};
		load();
		return () => {
			mounted = false;
		};
	}, [computeAllDayMaxHeight]);

	useEffect(() => {
		if (!heightLoaded || isResizing) return;
		if (window.electronAPI) {
			window.electronAPI.saveLayout({ allDayHeight });
		} else {
			localStorage.setItem('allDayHeight', String(allDayHeight));
		}
	}, [allDayHeight, isResizing, heightLoaded]);


	const handleAllDayDragStart = (event, schedule) => {
		if (isMemoHovering || !schedule?.id || schedule?.isTask) {
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
		setDragOverIndex(null);
	};

	const handleAllDayDragOver = (event, index) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		setDragOverIndex(index);
	};

	const handleAllDayDragLeave = (event) => {
		if (!event.currentTarget.contains(event.relatedTarget)) {
			setDragOverIndex(null);
		}
	};

	const handleAllDayDrop = (event, dropIndex) => {
		event.preventDefault();
		setDragOverIndex(null);

		if (!draggedAllDayId) return;

		const currentOrder = sortedAllDaySchedules;
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

	const tabs = [
		{ key: 'timeline', label: 'タイムライン' },
		{ key: 'tasks', label: 'タスク' },
	];
	const isAddDisabled = showTasks ? !onAddTask : !onAdd;

	const handleAddClick = () => {
		if (showTasks) {
			if (onAddTask) {
				onAddTask();
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
		const isDropTarget = dragOverIndex === index;
		const isPast = isSchedulePast(schedule, selectedDate);
 		const isTaskItem = !!schedule?.isTask;
 		const isCompleted = !!schedule?.completed;

		return (
			<div
				key={key}
				className={`group relative w-full overflow-hidden rounded-xl border border-indigo-100 bg-white p-4 pl-5 text-sm shadow-sm transition-all duration-200 ${
					isDragged ? 'opacity-60 ring-2 ring-indigo-200' : ''
				} ${isDropTarget ? 'ring-2 ring-indigo-300 bg-indigo-50/70' : ''} ${
					shouldDimForTask(schedule) ? 'opacity-60' : ''
				}`}
				draggable={!!schedule?.id && !isTaskItem}
				onDragStart={(event) => handleAllDayDragStart(event, schedule)}
				onDragEnd={handleAllDayDragEnd}
				onDragOver={(event) => handleAllDayDragOver(event, index)}
				onDragLeave={handleAllDayDragLeave}
				onDrop={(event) => handleAllDayDrop(event, index)}
				onClick={() => onEdit && onEdit(schedule)}
				onDoubleClick={() => onEdit && onEdit(schedule)}
			>
				<span className="absolute inset-y-3 left-0 w-1 rounded-full bg-amber-400" aria-hidden="true" />
				<div className="relative ml-3 flex flex-col gap-1">
					<div className="flex items-start justify-between gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<span
								className={`font-medium ${
									isTaskItem && isCompleted ? 'text-slate-500 line-through' : isPast ? 'text-slate-500' : 'text-slate-900'
								}`}
							>
								{schedule?.emoji ? `${schedule.emoji} ` : ''}
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
								className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
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

	const renderTimeCard = (schedule, index) => {
		const key = getScheduleKey(schedule, index, 'time-');
		const isPast = isSchedulePast(schedule, selectedDate);
		const isTaskSchedule = !!schedule?.isTask;
		const isCompleted = !!schedule?.completed;
		const timeLabel = schedule?.allDay ? '終日' : formatTimeLabel(schedule?.time);

		return (
			<div key={key} className="relative flex items-stretch gap-2">
				<div className="relative flex w-10 flex-col items-center justify-center text-[10px] text-slate-400">
					<div
						className="pointer-events-none absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-indigo-100"
						aria-hidden="true"
					/>
					<span className="relative z-10 inline-flex items-center justify-center rounded-full bg-white px-1.5 py-[1px] font-semibold text-indigo-500 tabular-nums shadow-sm">
						{timeLabel}
					</span>
				</div>
				<div
					className={`relative flex-1 cursor-pointer overflow-hidden rounded-xl border border-indigo-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-[1px] hover:shadow-md ${
						isPast ? 'opacity-80' : ''
					} ${shouldDimForTask(schedule) ? 'opacity-60' : ''}`}
					onClick={() => onEdit && onEdit(schedule)}
					onDoubleClick={() => onEdit && onEdit(schedule)}
				>
					<span className="absolute inset-y-3 left-0 w-1 rounded-full bg-indigo-300" aria-hidden="true" />
					<div className="relative ml-2.5 flex flex-wrap items-start gap-3">
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2">
								<span
									className={`truncate font-medium ${
										isTaskSchedule && isCompleted ? 'line-through text-slate-500' : 'text-slate-900'
									}`}
								>
									{schedule?.emoji ? `${schedule.emoji} ` : ''}
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
								className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
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

	const renderAllDaySection = () => {
		const clampedHeight = Math.max(ALL_DAY_MIN_HEIGHT, allDayHeight || ALL_DAY_MIN_HEIGHT);
		const hasAllDaySchedules = sortedAllDaySchedules.length > 0;
		const hasAllDayTasks = sortedAllDayTasks.length > 0;

		return (
			<div
				ref={allDaySectionRef}
				className="relative border-b border-slate-200 bg-white"
				style={{ height: `${clampedHeight}px` }}
			>
				<div className="flex h-full min-h-0 flex-col py-3">
					<div className="flex items-center justify-between px-4 pb-2 text-[11px] text-slate-500">
						<div className="inline-flex items-center gap-2">
							<span className="inline-flex h-6 items-center rounded-full bg-amber-100 px-3 font-semibold text-amber-700">
								終日
							</span>
							<span className="text-slate-400">(ドラッグで並び替え可能)</span>
						</div>
						{(hasAllDaySchedules || hasAllDayTasks) && (
							<span className="text-slate-400">
								{sortedAllDaySchedules.length + sortedAllDayTasks.length}件
							</span>
						)}
					</div>
					<div className="flex-1 min-h-0">
						<div className="custom-scrollbar h-full overflow-y-auto px-4 pb-3">
							{!hasAllDaySchedules && !hasAllDayTasks ? (
								<div className="flex min-h-full flex-col items-center justify-center gap-2 text-xs text-slate-400">
									<span>終日の予定やタスクはありません</span>
									<span className="text-[11px] text-slate-300">「＋」ボタンから項目を追加できます</span>
								</div>
							) : (
								<div className="flex flex-col gap-3">
									{sortedAllDaySchedules.map((schedule, index) => renderAllDayCard(schedule, index))}
									{hasAllDaySchedules && draggedAllDayId && (
										<div
											className={`h-12 rounded-xl border-2 border-dashed transition-colors duration-200 ${
												dragOverIndex === sortedAllDaySchedules.length
													? 'border-indigo-300 bg-indigo-50/60'
													: 'border-transparent'
											}`}
											onDragOver={(event) => handleAllDayDragOver(event, sortedAllDaySchedules.length)}
											onDragLeave={handleAllDayDragLeave}
											onDrop={(event) => handleAllDayDrop(event, sortedAllDaySchedules.length)}
										>
											<span className="sr-only">ここにドロップして末尾に移動</span>
										</div>
									)}

									{sortedAllDayTasks.map((task, index) =>
										renderAllDayCard(task, sortedAllDaySchedules.length + index)
									)}
								</div>
							)}
						</div>
					</div>
				</div>
				<div
					className={`absolute inset-x-0 bottom-0 flex h-4 items-center justify-center cursor-row-resize select-none ${
						isResizing ? 'bg-indigo-100/60' : 'bg-transparent'
					}`}
					onMouseDown={handleResizeStart}
				>
					<div
						className={`h-1 w-16 rounded-full transition-colors duration-200 ${
							isResizing ? 'bg-indigo-400' : 'bg-slate-300 hover:bg-indigo-300'
						}`}
					/>
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
							<div className="flex items-center gap-3 pb-3 text-[11px] font-semibold text-slate-400">
								<span className="h-px flex-1 bg-slate-200" />
								<span className="tracking-wide">時間指定</span>
								<span className="h-px flex-1 bg-slate-200" />
							</div>
							{sortedTimeItems.length === 0 ? (
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
								<div className="space-y-4 pb-2">
									{sortedTimeItems.map((schedule, index) => renderTimeCard(schedule, index))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const cardStyle = useMemo(() => {
		if (!cardMaxHeight) return undefined;
		const value = `${cardMaxHeight}px`;
		return { height: value, maxHeight: value };
	}, [cardMaxHeight]);

	return (
		<div
			ref={cardRef}
			className="flex h-full min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-xl"
			style={cardStyle}
		>
			<header ref={headerRef} className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 rounded-t-3xl">
				<div className="flex flex-wrap items-center gap-3">
					<div className="inline-flex items-center rounded-full bg-slate-100 p-1">
						{tabs.map((tab) => {
							const isActive = currentTab === tab.key;
							return (
								<button
									key={tab.key}
									type="button"
									onClick={() => handleTabButtonClick(tab.key)}
									className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
										isActive
											? 'bg-white text-indigo-600 shadow'
											: 'text-slate-500 hover:text-indigo-500'
									}`}
									aria-pressed={isActive}
								>
									{tab.label}
								</button>
							);
						})}
					</div>
					<span className="text-xs font-medium text-slate-400">
						{showTasks
							? `タスク ${availableTasks.length}件`
							: `予定 ${timelineEntries.length}件`}
					</span>
				</div>
				<button
					type="button"
					className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-600 transition-all duration-200 ${
						isAddDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-indigo-50 hover:shadow'
					}`}
					onClick={handleAddClick}
					disabled={isAddDisabled}
					title={showTasks ? 'タスクを追加' : '予定を追加'}
				>
					<span className="text-lg font-semibold leading-none">＋</span>
				</button>
			</header>

			<div className="flex-1 min-h-0 overflow-hidden">
				{showTasks ? (
					<TaskArea tasks={availableTasks} onEdit={onEdit} onToggleTask={onToggleTask} />
				) : (
					<div
						ref={timelineRef}
						className="flex h-full min-h-0 flex-col overflow-hidden rounded-b-3xl bg-slate-100/70"
					>
						{renderAllDaySection()}
						{renderTimelineSection()}
					</div>
				)}
			</div>
		</div>
	);
};

export default Timeline;
