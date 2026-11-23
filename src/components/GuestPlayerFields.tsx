import type { FormationPosition } from "../types/schema";
import type { GuestPlayerFieldValues } from "./guestPlayerFieldValues";

type TextField = "firstName" | "lastName" | "birthYear" | "jerseyNumber";

interface GuestPlayerFieldsProps {
  /** Unique per mount so label/input ids don't collide when two forms exist. */
  idPrefix: string;
  values: GuestPlayerFieldValues;
  positions: Pick<FormationPosition, "id" | "abbreviation" | "positionName">[];
  disabled?: boolean;
  firstNameRef?: React.Ref<HTMLInputElement>;
  onFieldChange: (field: TextField, value: string) => void;
  onPositionsChange: (positionIds: string[]) => void;
}

export function GuestPlayerFields({
  idPrefix,
  values,
  positions,
  disabled = false,
  firstNameRef,
  onFieldChange,
  onPositionsChange,
}: GuestPlayerFieldsProps) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-first-name`}>First name *</label>
        <input
          id={`${idPrefix}-first-name`}
          ref={firstNameRef}
          type="text"
          value={values.firstName}
          maxLength={50}
          disabled={disabled}
          onChange={(e) => onFieldChange("firstName", e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-last-name`}>Last name *</label>
        <input
          id={`${idPrefix}-last-name`}
          type="text"
          value={values.lastName}
          maxLength={50}
          disabled={disabled}
          onChange={(e) => onFieldChange("lastName", e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-birth-year`}>Birth year (optional)</label>
        <input
          id={`${idPrefix}-birth-year`}
          type="number"
          inputMode="numeric"
          value={values.birthYear}
          disabled={disabled}
          onChange={(e) => onFieldChange("birthYear", e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-jersey-number`}>Jersey number (optional)</label>
        <input
          id={`${idPrefix}-jersey-number`}
          type="number"
          inputMode="numeric"
          min="1"
          max="99"
          value={values.jerseyNumber}
          disabled={disabled}
          onChange={(e) => onFieldChange("jerseyNumber", e.target.value)}
        />
      </div>
      {positions.length > 0 && (
        <div className="checkbox-group">
          <label className="group-label">Preferred Positions (optional)</label>
          {positions.map((position) => (
            <label key={position.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={values.preferredPositionIds.includes(position.id)}
                disabled={disabled}
                onChange={(e) =>
                  onPositionsChange(
                    e.target.checked
                      ? [...values.preferredPositionIds, position.id]
                      : values.preferredPositionIds.filter((id) => id !== position.id),
                  )
                }
              />
              {position.abbreviation} - {position.positionName}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
