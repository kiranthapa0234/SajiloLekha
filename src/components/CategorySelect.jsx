/**
 * Category picker with inline creation.
 *
 * The product form used to ask for a raw category id, which nobody can type.
 * This shows the real list, lets a new category be created in place, and keeps
 * working on a workspace that has none yet.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { useApiMutation } from '@/hooks/useApi.js';
import { useCategories } from '@/hooks/useApi.js';
import { categories as categoriesApi } from '@/services/index.js';
import { Button, Input, Select } from '@/components/ui/index.jsx';

export default function CategorySelect({ id, value, onChange, disabled }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [newCategory, setNewCategory] = useState(null);
  const inputRef = useRef(null);

  const { data } = useCategories();

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  // A category created here should be selectable straight away.
  useEffect(() => {
    if (newCategory) onChange(newCategory._id);
  }, [newCategory, onChange]);

  const create = useApiMutation((payload) => categoriesApi.create(payload), {
    successMessage: 'Category created',
    onSuccess: (created) => {
      setNewCategory(created);
      setCreating(false);
      setName('');
    },
  });

  const options = [...(data ?? []), ...(newCategory ? [newCategory] : [])];

  if (creating) {
    return (
      <div className="flex items-start gap-2">
        <Input
          ref={inputRef}
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (name.trim().length >= 2) create.mutate({ name: name.trim() });
            }
            if (e.key === 'Escape') setCreating(false);
          }}
        />
        <Button
          type="button"
          size="sm"
          loading={create.isPending}
          disabled={name.trim().length < 2}
          onClick={() => create.mutate({ name: name.trim() })}
        >
          Create
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="flex-1"
      >
        <option value="">Uncategorised</option>
        {options.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setCreating(true)}
        title="Create a category"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New
      </Button>
    </div>
  );
}
