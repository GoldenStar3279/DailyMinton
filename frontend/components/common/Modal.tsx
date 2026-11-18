"use client";

import React, { useEffect, useId, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: "md" | "lg" | "2xl" | "4xl";
  children: React.ReactNode;
}

const MODAL_SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
};

/**
 * 네이티브 <dialog closedby="any"> 기반 다크 테마 공통 모달 컴포넌트
 */
const ModalComponent: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  size = "md",
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    const supportsClosedBy =
      typeof HTMLDialogElement !== "undefined" &&
      "closedBy" in HTMLDialogElement.prototype;

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isInsideContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isInsideContent) {
        dialog.close();
      }
    };

    if (!supportsClosedBy) {
      dialog.addEventListener("click", handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (!supportsClosedBy) {
        dialog.removeEventListener("click", handleBackdropClick);
      }
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby={titleId}
      className={`m-auto w-[calc(100%-2rem)] ${MODAL_SIZE_CLASS[size]} rounded-2xl border border-zinc-800 bg-[#161922] p-0 text-zinc-100 shadow-2xl`}
    >
      <div className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="모달 닫기"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
};

export const Modal = React.memo(ModalComponent);
